import pytest

from app.services.errors import IngestionError
from app.services.errors import IngestionErrorCode
from app.services.models import ParsedBlock, ParsedDocument
from app.services.normalizer import TextNormalizer


def test_normalizer_dehyphenates_soft_wraps_and_preserves_structure() -> None:
    normalizer = TextNormalizer()
    document = ParsedDocument(
        file_type="txt",
        source_title="sample.txt",
        blocks=[
            ParsedBlock(text="Customer access was suc-\ncessfully reset after retrying.", kind="paragraph"),
            ParsedBlock(text="*   Capture the request id", kind="list_item"),
            ParsedBlock(text="Q: What if it fails?", kind="qa_pair"),
        ],
    )

    normalized = normalizer.normalize_document(document)

    assert normalized.blocks[0].text == "Customer access was successfully reset after retrying."
    assert normalized.blocks[1].text == "* Capture the request id"
    assert normalized.blocks[2].text == "Q: What if it fails?"
    assert normalized.metadata["normalization"]["dehyphenated_breaks"] == 1


def test_normalizer_rejects_near_empty_documents() -> None:
    normalizer = TextNormalizer()
    document = ParsedDocument(
        file_type="txt",
        source_title="empty.txt",
        blocks=[ParsedBlock(text="..."), ParsedBlock(text="   ")],
    )

    with pytest.raises(IngestionError) as exc_info:
        normalizer.normalize_document(document)

    assert exc_info.value.code == IngestionErrorCode.EMPTY_DOCUMENT


def test_normalizer_rejects_symbol_soup_extractions() -> None:
    normalizer = TextNormalizer()
    document = ParsedDocument(
        file_type="pdf",
        source_title="bad.pdf",
        blocks=[ParsedBlock(text="@@@ ### --- *** !!! ???" * 8)],
    )

    with pytest.raises(IngestionError) as exc_info:
        normalizer.normalize_document(document)

    assert exc_info.value.code == IngestionErrorCode.LOW_QUALITY_EXTRACTION
