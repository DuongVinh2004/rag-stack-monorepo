from __future__ import annotations

from datetime import datetime, timezone

from app.core.db import Database
from app.services.errors import IngestionError, IngestionErrorCode
from app.services.models import IngestJobPayload, JobContext


def utc_now_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class StatusManager:
    def __init__(self, database: Database, embeddings_enabled: bool) -> None:
        self._database = database
        self._embeddings_enabled = embeddings_enabled

    async def mark_job_active(self, payload: IngestJobPayload) -> JobContext:
        started_at = utc_now_naive()
        vectorization_status = "PENDING" if self._embeddings_enabled else "DISABLED"

        async with self._database.acquire() as connection:
            async with connection.transaction():
                row = await connection.fetchrow(
                    """
                    SELECT
                      j."attempts",
                      j."maxAttempts",
                      j."status"::text AS job_status,
                      d."name" AS source_title
                    FROM "IngestJob" AS j
                    JOIN "DocumentVersion" AS dv ON dv."id" = j."documentVersionId"
                    JOIN "Document" AS d ON d."id" = dv."documentId"
                    WHERE j."id" = $1::uuid
                    FOR UPDATE
                    """,
                    payload.ingest_job_id,
                )

                if row is None:
                    raise IngestionError(
                        code=IngestionErrorCode.DB_WRITE_FAILED,
                        message="Ingest job record was not found",
                        retryable=False,
                    )

                if row["job_status"] in {"COMPLETED", "FAILED", "DEAD_LETTER"}:
                    return JobContext(
                        ingest_job_id=payload.ingest_job_id,
                        document_id=payload.document_id,
                        document_version_id=payload.document_version_id,
                        kb_id=payload.kb_id,
                        source_title=row["source_title"] or payload.source_title,
                        mime_type=payload.mime_type,
                        s3_key=payload.s3_key,
                        bucket=payload.bucket,
                        correlation_id=payload.correlation_id,
                        pipeline_version=payload.pipeline_version,
                        ingest_version=payload.ingest_version,
                        attempt_no=0,
                        max_attempts=int(row["maxAttempts"]),
                    )

                attempt_no = int(row["attempts"]) + 1
                max_attempts = int(row["maxAttempts"])

                await connection.execute(
                    """
                    UPDATE "IngestJob"
                    SET
                      "status" = 'ACTIVE'::"IngestJobStatus",
                      "attempts" = $2,
                      "retryable" = TRUE,
                      "errorCode" = NULL,
                      "errorMessage" = NULL,
                      "correlationId" = COALESCE($3, "correlationId"),
                      "startedAt" = $4,
                      "finishedAt" = NULL,
                      "updatedAt" = $4
                    WHERE "id" = $1::uuid
                    """,
                    payload.ingest_job_id,
                    attempt_no,
                    payload.correlation_id,
                    started_at,
                )

                await connection.execute(
                    """
                    UPDATE "DocumentVersion"
                    SET
                      "status" = 'PROCESSING'::"DocumentVersionStatus",
                      "vectorizationStatus" = $2::"VectorizationStatus",
                      "lastErrorCode" = NULL,
                      "lastErrorMessage" = NULL,
                      "startedAt" = $3,
                      "finishedAt" = NULL,
                      "updatedAt" = $3
                    WHERE "id" = $1::uuid
                    """,
                    payload.document_version_id,
                    vectorization_status,
                    started_at,
                )

                await connection.execute(
                    """
                    UPDATE "Document"
                    SET
                      "status" = 'PROCESSING'::"DocumentStatus",
                      "lastErrorCode" = NULL,
                      "lastErrorMessage" = NULL,
                      "updatedAt" = $2
                    WHERE "id" = $1::uuid
                    """,
                    payload.document_id,
                    started_at,
                )

        return JobContext(
            ingest_job_id=payload.ingest_job_id,
            document_id=payload.document_id,
            document_version_id=payload.document_version_id,
            kb_id=payload.kb_id,
            source_title=row["source_title"] or payload.source_title,
            mime_type=payload.mime_type,
            s3_key=payload.s3_key,
            bucket=payload.bucket,
            correlation_id=payload.correlation_id,
            pipeline_version=payload.pipeline_version,
            ingest_version=payload.ingest_version,
            attempt_no=attempt_no,
            max_attempts=max_attempts,
        )

    async def mark_retry_waiting(self, context: JobContext, error: IngestionError) -> None:
        now = utc_now_naive()
        async with self._database.acquire() as connection:
            async with connection.transaction():
                await connection.execute(
                    """
                    UPDATE "IngestJob"
                    SET
                      "status" = 'WAITING'::"IngestJobStatus",
                      "errorCode" = $2,
                      "errorMessage" = $3,
                      "retryable" = TRUE,
                      "finishedAt" = $4,
                      "updatedAt" = $4
                    WHERE "id" = $1::uuid
                    """,
                    context.ingest_job_id,
                    error.code.value,
                    error.message,
                    now,
                )
                await connection.execute(
                    """
                    UPDATE "DocumentVersion"
                    SET
                      "status" = 'PROCESSING'::"DocumentVersionStatus",
                      "lastErrorCode" = $2,
                      "lastErrorMessage" = $3,
                      "updatedAt" = $4
                    WHERE "id" = $1::uuid
                    """,
                    context.document_version_id,
                    error.code.value,
                    error.message,
                    now,
                )
                await connection.execute(
                    """
                    UPDATE "Document"
                    SET
                      "status" = 'PROCESSING'::"DocumentStatus",
                      "lastErrorCode" = $2,
                      "lastErrorMessage" = $3,
                      "updatedAt" = $4
                    WHERE "id" = $1::uuid
                    """,
                    context.document_id,
                    error.code.value,
                    error.message,
                    now,
                )

    async def mark_failure(self, context: JobContext, error: IngestionError, dead_letter: bool) -> None:
        now = utc_now_naive()
        job_status = "DEAD_LETTER" if dead_letter else "FAILED"
        vectorization_status = "FAILED" if self._embeddings_enabled else "DISABLED"

        async with self._database.acquire() as connection:
            async with connection.transaction():
                await connection.execute(
                    """
                    UPDATE "IngestJob"
                    SET
                      "status" = $2::"IngestJobStatus",
                      "errorCode" = $3,
                      "errorMessage" = $4,
                      "retryable" = $5,
                      "finishedAt" = $6,
                      "updatedAt" = $6
                    WHERE "id" = $1::uuid
                    """,
                    context.ingest_job_id,
                    job_status,
                    error.code.value,
                    error.message,
                    error.retryable,
                    now,
                )
                await connection.execute(
                    """
                    UPDATE "DocumentVersion"
                    SET
                      "status" = 'FAILED'::"DocumentVersionStatus",
                      "vectorizationStatus" = $2::"VectorizationStatus",
                      "lastErrorCode" = $3,
                      "lastErrorMessage" = $4,
                      "finishedAt" = $5,
                      "updatedAt" = $5
                    WHERE "id" = $1::uuid
                    """,
                    context.document_version_id,
                    vectorization_status,
                    error.code.value,
                    error.message,
                    now,
                )
                await connection.execute(
                    """
                    UPDATE "Document"
                    SET
                      "status" = 'FAILED'::"DocumentStatus",
                      "lastErrorCode" = $2,
                      "lastErrorMessage" = $3,
                      "updatedAt" = $4
                    WHERE "id" = $1::uuid
                    """,
                    context.document_id,
                    error.code.value,
                    error.message,
                    now,
                )

    async def mark_success(self, context: JobContext, chunk_count: int) -> None:
        now = utc_now_naive()
        vectorization_status = "COMPLETED" if self._embeddings_enabled else "DISABLED"

        async with self._database.acquire() as connection:
            async with connection.transaction():
                await connection.execute(
                    """
                    UPDATE "DocumentVersion"
                    SET
                      "status" = 'INDEXED'::"DocumentVersionStatus",
                      "vectorizationStatus" = $2::"VectorizationStatus",
                      "chunkCount" = $3,
                      "lastErrorCode" = NULL,
                      "lastErrorMessage" = NULL,
                      "finishedAt" = $4,
                      "indexedAt" = $4,
                      "updatedAt" = $4
                    WHERE "id" = $1::uuid
                    """,
                    context.document_version_id,
                    vectorization_status,
                    chunk_count,
                    now,
                )
                await connection.execute(
                    """
                    UPDATE "Document"
                    SET
                      "status" = 'INDEXED'::"DocumentStatus",
                      "lastErrorCode" = NULL,
                      "lastErrorMessage" = NULL,
                      "indexedAt" = $2,
                      "updatedAt" = $2
                    WHERE "id" = $1::uuid
                    """,
                    context.document_id,
                    now,
                )
                await connection.execute(
                    """
                    UPDATE "IngestJob"
                    SET
                      "status" = 'COMPLETED'::"IngestJobStatus",
                      "errorCode" = NULL,
                      "errorMessage" = NULL,
                      "retryable" = TRUE,
                      "finishedAt" = $2,
                      "updatedAt" = $2
                    WHERE "id" = $1::uuid
                    """,
                    context.ingest_job_id,
                    now,
                )
