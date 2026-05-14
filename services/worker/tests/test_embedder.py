import pytest

from app.core.settings import Settings
from app.services.embedder import Embedder
from app.services.models import ChunkRecord
from app.services.openai_embedding_client import EmbeddingBatchResult, EmbeddingBatchUsage
from app.services.token_counter import TokenCounter


def build_settings(**overrides) -> Settings:
    return Settings(
        database_url="postgresql://test:test@localhost:5432/test",
        s3_endpoint="http://localhost:9000",
        s3_bucket="test-bucket",
        aws_access_key_id="test-access",
        aws_secret_access_key="test-secret",
        openai_api_key="test-key",
        **overrides,
    )


def build_chunk(content: str = "Reset the worker before retrying.") -> ChunkRecord:
    return ChunkRecord(
        chunk_no=1,
        content=content,
        search_text=content.lower(),
        token_count=8,
        section_title="Troubleshooting",
        page_number=1,
        source_title="Runbook",
        language="en",
        chunking_strategy="section_aware",
        chunking_version="section_v2",
        checksum="checksum-1",
        metadata_json={},
    )


@pytest.mark.asyncio
async def test_embedder_respects_feature_disable() -> None:
    embedder = Embedder(
        build_settings(openai_embeddings_enabled=False),
        TokenCounter(),
    )

    assert embedder.enabled is False


@pytest.mark.asyncio
async def test_embedder_applies_embeddings_and_model_metadata() -> None:
    embedder = Embedder(build_settings(), TokenCounter())
    embedder._client = type(  # noqa: SLF001 - test seam
        "Client",
        (),
        {
            "enabled": True,
            "model_name": "text-embedding-3-small",
            "embed_texts": staticmethod(
                lambda *_args, **_kwargs: None,
            ),
        },
    )()

    async def fake_embed_texts(*_args, **_kwargs):
        return EmbeddingBatchResult(
            embeddings=[[0.1, 0.2, 0.3]],
            usage=EmbeddingBatchUsage(input_tokens=12, total_tokens=12),
            latency_ms=10.5,
            attempts=1,
        )

    embedder._client.embed_texts = fake_embed_texts  # type: ignore[attr-defined]  # noqa: SLF001
    chunks = [build_chunk()]

    result = await embedder.embed_chunks(chunks, {"correlation_id": "corr-1"})

    assert result[0].embedding == [0.1, 0.2, 0.3]
    assert result[0].embedding_model == "text-embedding-3-small"
    assert result[0].embedding_dim == 3
