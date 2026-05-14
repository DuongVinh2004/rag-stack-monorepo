import pytest

from app.core.settings import Settings
from app.services.chunker import Chunker
from app.services.embedder import Embedder
from app.services.errors import IngestionError, IngestionErrorCode
from app.services.ingest_pipeline import IngestPipeline
from app.services.models import JobContext
from app.services.normalizer import TextNormalizer
from app.services.parsers.factory import ParserFactory
from app.services.token_counter import TokenCounter


class FakeStatusManager:
    def __init__(self) -> None:
        self.retry_error = None
        self.failure = None
        self.success = None

    async def mark_job_active(self, payload):
        return JobContext(
            ingest_job_id=payload.ingest_job_id,
            document_id=payload.document_id,
            document_version_id=payload.document_version_id,
            kb_id=payload.kb_id,
            source_title=payload.source_title,
            mime_type=payload.mime_type,
            s3_key=payload.s3_key,
            bucket=payload.bucket,
            correlation_id=payload.correlation_id,
            pipeline_version=payload.pipeline_version,
            ingest_version=payload.ingest_version,
            attempt_no=1,
            max_attempts=3,
        )

    async def mark_retry_waiting(self, context, error):
        self.retry_error = error

    async def mark_failure(self, context, error, dead_letter):
        self.failure = (error, dead_letter)

    async def mark_success(self, context, chunk_count: int):
        self.success = (context, chunk_count)


class FakeFileFetcher:
    async def fetch_bytes(self, bucket: str, key: str) -> bytes:
        return (
            "# Guide\n\n"
            "Reset the worker before retrying the failed queue item.\n\n"
            "Escalation:\n"
            "Open an incident after repeated failures."
        ).encode("utf-8")


class CollectingIndexer:
    def __init__(self, should_fail: bool = False) -> None:
        self.should_fail = should_fail
        self.saved_chunks = None

    async def persist_chunks(self, context, chunks) -> None:
        if self.should_fail:
            raise IngestionError(
                code=IngestionErrorCode.DB_WRITE_FAILED,
                message="database unavailable",
                retryable=True,
            )
        self.saved_chunks = list(chunks)


@pytest.mark.asyncio
async def test_ingest_pipeline_completes_without_embeddings() -> None:
    settings = Settings(
        database_url="postgresql://test:test@localhost:5432/test",
        s3_endpoint="http://localhost:9000",
        s3_bucket="test-bucket",
        aws_access_key_id="test-access",
        aws_secret_access_key="test-secret",
        openai_api_key=None,
        chunk_target_tokens=60,
        chunk_overlap_tokens=10,
    )
    token_counter = TokenCounter()
    normalizer = TextNormalizer()
    status_manager = FakeStatusManager()
    indexer = CollectingIndexer()
    pipeline = IngestPipeline(
        status_manager=status_manager,
        file_fetcher=FakeFileFetcher(),
        parser_factory=ParserFactory(),
        normalizer=normalizer,
        chunker=Chunker(settings, token_counter, normalizer),
        embedder=Embedder(settings, token_counter),
        indexer=indexer,
    )

    result = await pipeline.process(
        {
            "bucket": "knowledge-base-bucket",
            "correlationId": "corr-1",
            "documentId": "doc-1",
            "documentVersionId": "ver-1",
            "ingestJobId": "job-1",
            "ingestVersion": 1,
            "kbId": "kb-1",
            "mimeType": "text/plain",
            "pipelineVersion": "phase2.v1",
            "s3Key": "kb-1/runbook.txt",
            "sourceTitle": "Runbook",
        },
        queue_job_id="queue-1",
    )

    assert result["status"] == "completed"
    assert indexer.saved_chunks is not None
    assert len(indexer.saved_chunks) >= 1
    assert indexer.saved_chunks[0].chunking_version == settings.chunking_version
    assert indexer.saved_chunks[0].metadata_json["parser"] == "text"
    assert status_manager.retry_error is None
    assert status_manager.failure is None
    assert status_manager.success is not None
    assert status_manager.success[1] == len(indexer.saved_chunks)


@pytest.mark.asyncio
async def test_ingest_pipeline_marks_retryable_failure() -> None:
    settings = Settings(
        database_url="postgresql://test:test@localhost:5432/test",
        s3_endpoint="http://localhost:9000",
        s3_bucket="test-bucket",
        aws_access_key_id="test-access",
        aws_secret_access_key="test-secret",
        openai_api_key=None,
        chunk_target_tokens=60,
        chunk_overlap_tokens=10,
    )
    token_counter = TokenCounter()
    normalizer = TextNormalizer()
    status_manager = FakeStatusManager()
    pipeline = IngestPipeline(
        status_manager=status_manager,
        file_fetcher=FakeFileFetcher(),
        parser_factory=ParserFactory(),
        normalizer=normalizer,
        chunker=Chunker(settings, token_counter, normalizer),
        embedder=Embedder(settings, token_counter),
        indexer=CollectingIndexer(should_fail=True),
    )

    with pytest.raises(IngestionError) as exc_info:
        await pipeline.process(
            {
                "bucket": "knowledge-base-bucket",
                "correlationId": "corr-2",
                "documentId": "doc-2",
                "documentVersionId": "ver-2",
                "ingestJobId": "job-2",
                "ingestVersion": 1,
                "kbId": "kb-2",
                "mimeType": "text/plain",
                "pipelineVersion": "phase2.v1",
                "s3Key": "kb-2/runbook.txt",
                "sourceTitle": "Runbook",
            },
            queue_job_id="queue-2",
        )

    assert exc_info.value.code == IngestionErrorCode.DB_WRITE_FAILED
    assert status_manager.retry_error is not None
    assert status_manager.failure is None
