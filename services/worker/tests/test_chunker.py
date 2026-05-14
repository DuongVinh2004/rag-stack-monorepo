from app.core.settings import Settings
from app.services.chunker import Chunker
from app.services.models import ParsedBlock, ParsedDocument
from app.services.normalizer import TextNormalizer
from app.services.token_counter import TokenCounter


def _build_settings(**overrides) -> Settings:
    values = {
        "database_url": "postgresql://test:test@localhost:5432/test",
        "s3_endpoint": "http://localhost:9000",
        "s3_bucket": "test-bucket",
        "aws_access_key_id": "test-access",
        "aws_secret_access_key": "test-secret",
        "chunk_target_tokens": 60,
        "chunk_overlap_tokens": 12,
    }
    values.update(overrides)
    return Settings(
        **values,
    )


def test_chunker_uses_section_titles_page_spans_and_deterministic_checksums() -> None:
    settings = _build_settings()
    normalizer = TextNormalizer()
    chunker = Chunker(settings, TokenCounter(), normalizer)
    document = ParsedDocument(
        file_type="pdf",
        source_title="manual.pdf",
        blocks=[
            ParsedBlock(text="Overview", kind="heading", page_number=1, metadata={"heading_level": 1}),
            ParsedBlock(text=" ".join(["alpha"] * 90), page_number=1),
            ParsedBlock(text=" ".join(["beta"] * 90), page_number=2),
            ParsedBlock(text="Escalation", kind="heading", page_number=2, metadata={"heading_level": 1}),
            ParsedBlock(text=" ".join(["gamma"] * 40), page_number=2),
        ],
        metadata={
            "parser": "pypdf",
            "page_mapping_available": True,
            "extraction_warnings": ["repeated_page_margins_removed"],
            "normalization": {"version": "text_normalization_v2"},
        },
    )

    first = chunker.chunk_document(document)
    second = chunker.chunk_document(document)

    assert [chunk.chunk_no for chunk in first] == list(range(1, len(first) + 1))
    assert [chunk.checksum for chunk in first] == [chunk.checksum for chunk in second]
    assert first[0].section_title == "Overview"
    assert first[0].metadata_json["page_start"] == 1
    assert any(chunk.metadata_json["page_end"] == 2 for chunk in first)
    assert first[0].metadata_json["parser"] == "pypdf"
    assert first[0].metadata_json["chunking"]["version"] == settings.chunking_version


def test_chunker_keeps_small_documents_in_one_chunk() -> None:
    settings = _build_settings(chunk_target_tokens=120, chunk_overlap_tokens=20)
    normalizer = TextNormalizer()
    chunker = Chunker(settings, TokenCounter(), normalizer)
    document = ParsedDocument(
        file_type="txt",
        source_title="tiny.txt",
        blocks=[ParsedBlock(text="Single paragraph with enough words to be indexed safely." * 2)],
        metadata={"parser": "text", "page_mapping_available": False, "normalization": {"version": "text_normalization_v2"}},
    )

    chunks = chunker.chunk_document(document)

    assert len(chunks) == 1
    assert chunks[0].section_title is None
    assert chunks[0].metadata_json["page_numbers"] == []


def test_chunker_keeps_faq_question_and_answer_together() -> None:
    settings = _build_settings(chunk_target_tokens=70, chunk_overlap_tokens=8)
    normalizer = TextNormalizer()
    chunker = Chunker(settings, TokenCounter(), normalizer)
    document = ParsedDocument(
        file_type="txt",
        source_title="faq.txt",
        blocks=[
            ParsedBlock(text="FAQ", kind="heading", metadata={"heading_level": 1}),
            ParsedBlock(text="Q: How do I requeue the job?", kind="qa_pair", metadata={"qa_label": "Q"}),
            ParsedBlock(text="A: Requeue it from the admin queue view.", kind="qa_pair", metadata={"qa_label": "A"}),
            ParsedBlock(text="Q: When do I escalate?", kind="qa_pair", metadata={"qa_label": "Q"}),
            ParsedBlock(text="A: Escalate after two failed retries.", kind="qa_pair", metadata={"qa_label": "A"}),
        ],
        metadata={"parser": "text", "page_mapping_available": False, "normalization": {"version": "text_normalization_v2"}},
    )

    chunks = chunker.chunk_document(document)

    assert len(chunks) >= 1
    assert "Q: How do I requeue the job?" in chunks[0].content
    assert "A: Requeue it from the admin queue view." in chunks[0].content
    assert chunks[0].metadata_json["contains_structured_content"] is True
