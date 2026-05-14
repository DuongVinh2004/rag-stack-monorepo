import pytest

from app.core.settings import Settings
from app.services.errors import IngestionError, IngestionErrorCode
from app.services.openai_embedding_client import OpenAiEmbeddingClient


class FakeEmbeddingData:
    def __init__(self, embedding: list[float]) -> None:
        self.embedding = embedding


class FakeEmbeddingResponse:
    def __init__(self, embeddings: list[list[float]]) -> None:
        self.data = [FakeEmbeddingData(embedding) for embedding in embeddings]
        self.usage = type(
            "Usage",
            (),
            {
                "prompt_tokens": 12,
                "total_tokens": 12,
            },
        )()


def build_settings(**overrides) -> Settings:
    return Settings(
        database_url="postgresql://test:test@localhost:5432/test",
        s3_endpoint="http://localhost:9000",
        s3_bucket="test-bucket",
        aws_access_key_id="test-access",
        aws_secret_access_key="test-secret",
        openai_api_key="test-key",
        openai_retry_base_delay_ms=0,
        **overrides,
    )


@pytest.mark.asyncio
async def test_openai_embedding_client_retries_rate_limits(monkeypatch) -> None:
    class FakeRateLimitError(Exception):
        status_code = 429

    monkeypatch.setattr("app.services.openai_embedding_client.RateLimitError", FakeRateLimitError)
    client = OpenAiEmbeddingClient(build_settings(openai_max_retries=1))

    class FakeEmbeddingsApi:
        def __init__(self) -> None:
            self.calls = 0

        async def create(self, **_: object):
            self.calls += 1
            if self.calls == 1:
                raise FakeRateLimitError("slow down")
            return FakeEmbeddingResponse([[0.1, 0.2]])

    api = FakeEmbeddingsApi()
    client._client = type("Client", (), {"embeddings": api})()  # noqa: SLF001

    result = await client.embed_texts(["reset worker"])

    assert api.calls == 2
    assert result.attempts == 2
    assert result.embeddings == [[0.1, 0.2]]


@pytest.mark.asyncio
async def test_openai_embedding_client_maps_auth_errors(monkeypatch) -> None:
    class FakeAuthError(Exception):
        status_code = 401

    monkeypatch.setattr("app.services.openai_embedding_client.AuthenticationError", FakeAuthError)
    client = OpenAiEmbeddingClient(build_settings())

    class FakeEmbeddingsApi:
        async def create(self, **_: object):
            raise FakeAuthError("bad key")

    client._client = type("Client", (), {"embeddings": FakeEmbeddingsApi()})()  # noqa: SLF001

    with pytest.raises(IngestionError) as exc_info:
        await client.embed_texts(["reset worker"])

    assert exc_info.value.code == IngestionErrorCode.OPENAI_AUTH_ERROR
    assert exc_info.value.retryable is False
    assert exc_info.value.details["attempts"] == 1


@pytest.mark.asyncio
async def test_openai_embedding_client_rejects_incomplete_batches() -> None:
    client = OpenAiEmbeddingClient(build_settings())

    class FakeEmbeddingsApi:
        async def create(self, **_: object):
            return FakeEmbeddingResponse([[0.1, 0.2]])

    client._client = type("Client", (), {"embeddings": FakeEmbeddingsApi()})()  # noqa: SLF001

    with pytest.raises(IngestionError) as exc_info:
        await client.embed_texts(["one", "two"])

    assert exc_info.value.code == IngestionErrorCode.OPENAI_EMBEDDING_FAILED
    assert exc_info.value.retryable is False
