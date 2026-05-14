from __future__ import annotations

from bullmq import Worker

try:
    from bullmq import UnrecoverableError
except ImportError:  # pragma: no cover - compatibility with older bullmq-python releases.
    class UnrecoverableError(Exception):
        pass

from app.core.logging import get_logger
from app.core.settings import Settings
from app.services.errors import IngestionError
from app.services.ingest_pipeline import IngestPipeline


class IngestConsumer:
    def __init__(self, settings: Settings, pipeline: IngestPipeline) -> None:
        self._settings = settings
        self._pipeline = pipeline
        self._worker: Worker | None = None
        self._logger = get_logger("worker.consumer")
        self._started = False

    @property
    def is_running(self) -> bool:
        return self._started and self._worker is not None

    async def start(self) -> None:
        self._worker = Worker(
            self._settings.ingest_queue_name,
            self._process_job,
            {
                "connection": {
                    "host": self._settings.redis_host,
                    "port": self._settings.redis_port,
                },
                "concurrency": self._settings.worker_concurrency,
            },
        )
        self._logger.info(
            "Started ingest worker",
            extra={
                "event": "worker_started",
                "queue_name": self._settings.ingest_queue_name,
                "worker_concurrency": self._settings.worker_concurrency,
            },
        )
        self._started = True

    async def stop(self) -> None:
        if self._worker is not None:
            await self._worker.close()
            self._started = False
            self._logger.info("Stopped ingest worker", extra={"event": "worker_stopped"})
            self._worker = None

    async def _process_job(self, job, token) -> dict:
        queue_job_id = str(job.id)
        raw_payload = dict(job.data or {})
        log_context = {
            "correlation_id": raw_payload.get("correlationId"),
            "document_id": raw_payload.get("documentId"),
            "document_version_id": raw_payload.get("documentVersionId"),
            "event": "worker_job_received",
            "ingest_job_id": raw_payload.get("ingestJobId"),
            "job_id": raw_payload.get("ingestJobId"),
            "kb_id": raw_payload.get("kbId"),
            "queue_job_id": queue_job_id,
        }
        self._logger.info("Picked up ingest job", extra=log_context)
        try:
            result = await self._pipeline.process(raw_payload, queue_job_id=queue_job_id)
            self._logger.info(
                "Completed ingest job",
                extra=log_context | {"event": "worker_job_completed"} | result,
            )
            return result
        except IngestionError as exc:
            self._logger.warning(
                "Ingest job raised handled error",
                extra=log_context
                | {
                    "event": "worker_job_retryable_failure" if exc.retryable else "worker_job_terminal_failure",
                    "error_code": exc.code.value,
                    "retryable": exc.retryable,
                },
            )
            if exc.retryable:
                raise Exception(exc.message) from exc
            raise UnrecoverableError(exc.message) from exc
