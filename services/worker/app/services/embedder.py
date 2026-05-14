from __future__ import annotations

from app.core.logging import get_logger
from app.core.settings import Settings
from app.services.models import ChunkRecord
from app.services.openai_embedding_client import OpenAiEmbeddingClient
from app.services.token_counter import TokenCounter


class Embedder:
    def __init__(self, settings: Settings, token_counter: TokenCounter) -> None:
        self._settings = settings
        self._token_counter = token_counter
        self._logger = get_logger("worker.openai.embedder")
        self._client = OpenAiEmbeddingClient(settings)

    @property
    def enabled(self) -> bool:
        return self._client.enabled

    @property
    def model_name(self) -> str | None:
        return self._client.model_name

    async def embed_chunks(
        self,
        chunks: list[ChunkRecord],
        request_context: dict | None = None,
    ) -> list[ChunkRecord]:
        if not self.enabled:
            return chunks

        batches = self._build_batches(chunks)

        for batch_index, batch in enumerate(batches, start=1):
            result = await self._client.embed_texts(
                [chunk.content for chunk in batch],
                (request_context or {})
                | {
                    "batch_index": batch_index,
                    "batch_size": len(batch),
                },
            )

            for chunk, embedding in zip(batch, result.embeddings, strict=True):
                chunk.embedding = embedding
                chunk.embedding_model = self._settings.openai_embedding_model
                chunk.embedding_dim = len(embedding)

            self._logger.info(
                "Completed OpenAI embedding batch",
                extra=(request_context or {})
                | {
                    "attempts": result.attempts,
                    "event": "openai_embedding_batch_completed",
                    "batch_index": batch_index,
                    "batch_size": len(batch),
                    "embedding_model": self._settings.openai_embedding_model,
                    "latency_ms": result.latency_ms,
                    "input_tokens": result.usage.input_tokens,
                    "total_tokens": result.usage.total_tokens,
                },
            )

        return chunks

    def _build_batches(self, chunks: list[ChunkRecord]) -> list[list[ChunkRecord]]:
        batches: list[list[ChunkRecord]] = []
        current_batch: list[ChunkRecord] = []
        current_tokens = 0

        for chunk in chunks:
            chunk_tokens = self._token_counter.count(chunk.content)
            if current_batch and (
                len(current_batch) >= self._settings.openai_embedding_batch_size
                or current_tokens + chunk_tokens > self._settings.openai_embedding_batch_token_limit
            ):
                batches.append(current_batch)
                current_batch = []
                current_tokens = 0

            current_batch.append(chunk)
            current_tokens += chunk_tokens

        if current_batch:
            batches.append(current_batch)
        return batches
