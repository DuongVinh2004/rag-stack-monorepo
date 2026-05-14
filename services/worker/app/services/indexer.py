from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Sequence

import asyncpg

from app.core.db import Database
from app.services.errors import IngestionError, IngestionErrorCode
from app.services.models import ChunkRecord, JobContext


def utc_now_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Indexer:
    def __init__(self, database: Database) -> None:
        self._database = database

    async def persist_chunks(
        self,
        context: JobContext,
        chunks: Sequence[ChunkRecord],
    ) -> None:
        persisted_at = utc_now_naive()
        try:
            async with self._database.acquire() as connection:
                async with connection.transaction():
                    await connection.execute(
                        """
                        UPDATE "DocumentChunk"
                        SET
                          "supersededAt" = $2,
                          "updatedAt" = $2
                        WHERE "documentVersionId" = $1::uuid AND "supersededAt" IS NULL
                        """,
                        context.document_version_id,
                        persisted_at,
                    )

                    await connection.executemany(
                        """
                        INSERT INTO "DocumentChunk" (
                          "id",
                          "documentId",
                          "documentVersionId",
                          "kbId",
                          "chunkNo",
                          "content",
                          "searchText",
                          "tokenCount",
                          "sectionTitle",
                          "pageNumber",
                          "sourceTitle",
                          "language",
                          "chunkingStrategy",
                          "chunkingVersion",
                          "embeddingModel",
                          "embeddingDim",
                          "embedding",
                          "checksum",
                          "metadataJson",
                          "supersededAt",
                          "createdAt",
                          "updatedAt"
                        )
                        VALUES (
                          $1::uuid,
                          $2::uuid,
                          $3::uuid,
                          $4::uuid,
                          $5,
                          $6,
                          $7,
                          $8,
                          $9,
                          $10,
                          $11,
                          $12,
                          $13,
                          $14,
                          $15,
                          $16,
                          $17::vector,
                          $18,
                          $19::jsonb,
                          NULL,
                          $20,
                          $20
                        )
                        """,
                        [
                            (
                                str(uuid.uuid4()),
                                context.document_id,
                                context.document_version_id,
                                context.kb_id,
                                chunk.chunk_no,
                                chunk.content,
                                chunk.search_text,
                                chunk.token_count,
                                chunk.section_title,
                                chunk.page_number,
                                chunk.source_title,
                                chunk.language,
                                chunk.chunking_strategy,
                                chunk.chunking_version,
                                chunk.embedding_model,
                                chunk.embedding_dim,
                                self._serialize_embedding(chunk.embedding),
                                chunk.checksum,
                                json.dumps(chunk.metadata_json),
                                persisted_at,
                            )
                            for chunk in chunks
                        ],
                    )
        except asyncpg.PostgresError as exc:
            code = (
                IngestionErrorCode.VECTOR_PERSIST_FAILED
                if "vector" in str(exc).lower()
                else IngestionErrorCode.DB_WRITE_FAILED
            )
            raise IngestionError(
                code=code,
                message="Failed to persist document chunks",
                retryable=True,
            ) from exc

    def _serialize_embedding(self, embedding: list[float] | None) -> str | None:
        if embedding is None:
            return None
        return "[" + ",".join(f"{value:.12f}" for value in embedding) + "]"
