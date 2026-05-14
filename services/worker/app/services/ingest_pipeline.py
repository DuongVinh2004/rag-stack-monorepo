from __future__ import annotations

import hashlib
from time import perf_counter

from app.core.logging import get_logger
from app.core.metrics import emit_counter, emit_duration
from app.services.chunker import Chunker
from app.services.embedder import Embedder
from app.services.errors import IngestionError, IngestionErrorCode
from app.services.file_fetcher import FileFetcher
from app.services.indexer import Indexer
from app.services.models import IngestJobPayload
from app.services.normalizer import TextNormalizer
from app.services.parsers.factory import ParserFactory
from app.services.status_manager import StatusManager


class IngestPipeline:
    def __init__(
        self,
        status_manager: StatusManager,
        file_fetcher: FileFetcher,
        parser_factory: ParserFactory,
        normalizer: TextNormalizer,
        chunker: Chunker,
        embedder: Embedder,
        indexer: Indexer,
    ) -> None:
        self._status_manager = status_manager
        self._file_fetcher = file_fetcher
        self._parser_factory = parser_factory
        self._normalizer = normalizer
        self._chunker = chunker
        self._embedder = embedder
        self._indexer = indexer
        self._logger = get_logger("worker.ingest")

    async def process(self, raw_payload: dict, queue_job_id: str) -> dict:
        payload = IngestJobPayload.from_dict(raw_payload)
        context = await self._status_manager.mark_job_active(payload)
        log_context = self._build_log_context(context, queue_job_id)

        if context.attempt_no == 0:
            self._logger.info("Skipping terminal ingest job", extra=log_context | {"event": "job_skipped"})
            return {"status": "skipped"}

        overall_start = perf_counter()
        stage_timings_ms: dict[str, float] = {}
        try:
            file_bytes, file_type = await self._fetch_document(context, log_context, stage_timings_ms)
            parsed = self._parse_document(file_bytes, file_type, context.source_title, log_context, stage_timings_ms)
            normalized = self._normalize_document(parsed, log_context, stage_timings_ms)
            chunks = self._chunk_document(normalized, log_context, stage_timings_ms)
            chunks = await self._embed_chunks(chunks, log_context, stage_timings_ms)
            await self._persist_chunks(context, chunks, log_context, stage_timings_ms)
            total_ms = round((perf_counter() - overall_start) * 1000, 2)
            stage_timings_ms["total_ms"] = total_ms
            emit_counter(
                "ingest_jobs_total",
                tags={"outcome": "success", "kb_id": context.kb_id},
            )
            emit_duration(
                "ingest_job_duration_ms",
                total_ms,
                tags={"outcome": "success", "kb_id": context.kb_id},
            )
            self._log_step(
                "Completed ingest pipeline",
                log_context,
                "ingest_completed",
                overall_start,
                ingest_timings_ms=stage_timings_ms,
            )
            return {"status": "completed", "chunk_count": len(chunks), "file_type": file_type}
        except IngestionError as exc:
            await self._handle_failure(context, exc, log_context, overall_start, stage_timings_ms)
            raise
        except Exception as exc:
            wrapped = IngestionError(
                code=IngestionErrorCode.TRANSIENT_EXTERNAL_ERROR,
                message="Unhandled ingestion worker error",
                retryable=True,
            )
            await self._handle_failure(context, wrapped, log_context, overall_start, stage_timings_ms)
            raise wrapped from exc

    async def _fetch_document(
        self, context, log_context: dict, stage_timings_ms: dict[str, float]
    ) -> tuple[bytes, str]:
        started_at = perf_counter()
        file_bytes = await self._file_fetcher.fetch_bytes(context.bucket, context.s3_key)
        file_type = self._parser_factory.detect_file_type(file_bytes, context.mime_type, context.s3_key)
        self._log_step(
            "Fetched document from object storage",
            log_context,
            "file_fetched",
            started_at,
            file_type=file_type,
            object_key_hash=self._hash_storage_key(context.s3_key),
        )
        stage_timings_ms["object_fetch_ms"] = round((perf_counter() - started_at) * 1000, 2)
        return file_bytes, file_type

    def _parse_document(
        self,
        file_bytes: bytes,
        file_type: str,
        source_title: str,
        log_context: dict,
        stage_timings_ms: dict[str, float],
    ):
        started_at = perf_counter()
        parsed = self._parser_factory.get_parser(file_type).parse(file_bytes, source_title)
        self._log_step(
            "Parsed document",
            log_context,
            "document_parsed",
            started_at,
            block_count=len(parsed.blocks),
            parser=parsed.metadata.get("parser", file_type),
            extraction_warning_count=len(parsed.metadata.get("extraction_warnings", [])),
        )
        stage_timings_ms["parse_ms"] = round((perf_counter() - started_at) * 1000, 2)
        return parsed

    def _normalize_document(self, parsed, log_context: dict, stage_timings_ms: dict[str, float]):
        started_at = perf_counter()
        normalized = self._normalizer.normalize_document(parsed)
        self._log_step(
            "Normalized parsed document",
            log_context,
            "document_normalized",
            started_at,
            block_count=len(normalized.blocks),
            normalization_version=normalized.metadata.get("normalization", {}).get("version"),
        )
        stage_timings_ms["normalize_ms"] = round((perf_counter() - started_at) * 1000, 2)
        return normalized

    def _chunk_document(self, normalized, log_context: dict, stage_timings_ms: dict[str, float]):
        started_at = perf_counter()
        chunks = self._chunker.chunk_document(normalized)
        self._log_step(
            "Chunked normalized text",
            log_context,
            "document_chunked",
            started_at,
            chunk_count=len(chunks),
            chunking_version=chunks[0].chunking_version if chunks else None,
            avg_chunk_tokens=round(sum(chunk.token_count for chunk in chunks) / len(chunks), 2) if chunks else 0,
        )
        stage_timings_ms["chunk_ms"] = round((perf_counter() - started_at) * 1000, 2)
        return chunks

    async def _embed_chunks(self, chunks, log_context: dict, stage_timings_ms: dict[str, float]):
        if not self._embedder.enabled:
            self._logger.info(
                "Embedding generation is disabled",
                extra=log_context | {"event": "embeddings_disabled"},
            )
            stage_timings_ms["embed_ms"] = 0.0
            return chunks

        started_at = perf_counter()
        embedded_chunks = await self._embedder.embed_chunks(chunks, log_context)
        self._log_step(
            "Generated embeddings for chunks",
            log_context,
            "embeddings_generated",
            started_at,
            embedding_model=self._embedder.model_name,
            embedding_enabled=self._embedder.enabled,
        )
        stage_timings_ms["embed_ms"] = round((perf_counter() - started_at) * 1000, 2)
        return embedded_chunks

    async def _persist_chunks(self, context, chunks, log_context: dict, stage_timings_ms: dict[str, float]) -> None:
        started_at = perf_counter()
        await self._indexer.persist_chunks(context, chunks)
        await self._status_manager.mark_success(context, len(chunks))
        self._log_step(
            "Persisted indexed document chunks",
            log_context,
            "chunks_persisted",
            started_at,
            chunk_count=len(chunks),
        )
        stage_timings_ms["persist_ms"] = round((perf_counter() - started_at) * 1000, 2)

    def _build_log_context(self, context, queue_job_id: str) -> dict:
        return {
            "correlation_id": context.correlation_id,
            "kb_id": context.kb_id,
            "document_id": context.document_id,
            "document_version_id": context.document_version_id,
            "ingest_job_id": context.ingest_job_id,
            "job_id": context.ingest_job_id,
            "queue_job_id": queue_job_id,
            "attempt_no": context.attempt_no,
            "max_attempts": context.max_attempts,
            "pipeline_version": context.pipeline_version,
            "ingest_version": context.ingest_version,
        }

    def _log_step(
        self,
        message: str,
        log_context: dict,
        event: str,
        started_at: float,
        **extra: object,
    ) -> None:
        self._logger.info(
            message,
            extra=log_context
            | {
                "event": event,
                "duration_ms": round((perf_counter() - started_at) * 1000, 2),
            }
            | extra,
        )

    async def _handle_failure(
        self,
        context,
        error: IngestionError,
        log_context: dict,
        started_at: float,
        stage_timings_ms: dict[str, float],
    ) -> None:
        dead_letter = error.retryable and context.attempt_no >= context.max_attempts
        if error.retryable and not dead_letter:
            await self._status_manager.mark_retry_waiting(context, error)
        else:
            await self._status_manager.mark_failure(context, error, dead_letter=dead_letter)

        fail_ms = round((perf_counter() - started_at) * 1000, 2)
        stage_timings = dict(stage_timings_ms)
        stage_timings["total_ms"] = fail_ms
        outcome = "dead_letter" if dead_letter else "failure"
        emit_counter(
            "ingest_jobs_total",
            tags={"outcome": outcome, "kb_id": context.kb_id},
        )
        emit_duration(
            "ingest_job_duration_ms",
            fail_ms,
            tags={"outcome": outcome, "kb_id": context.kb_id},
        )
        self._logger.error(
            "Ingest pipeline failed",
            extra=log_context
            | {
                "event": "ingest_failed",
                "duration_ms": fail_ms,
                "ingest_timings_ms": stage_timings,
                "error_code": error.code.value,
                "retryable": error.retryable,
                "dead_letter": dead_letter,
            },
        )

    def _hash_storage_key(self, value: str) -> str:
        return hashlib.sha256(value.encode("utf-8")).hexdigest()[:16]
