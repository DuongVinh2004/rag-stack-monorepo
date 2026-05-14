import pytest

from app.core.settings import Settings
from app.services.errors import IngestionError, IngestionErrorCode
from app.workers.ingest_consumer import IngestConsumer


class FakeJob:
    def __init__(self, payload: dict) -> None:
        self.id = "queue-job-1"
        self.data = payload


class SuccessfulPipeline:
    async def process(self, raw_payload: dict, queue_job_id: str) -> dict:
        return {"status": "completed", "queue_job_id": queue_job_id}


class RetryablePipeline:
    async def process(self, raw_payload: dict, queue_job_id: str) -> dict:
        raise IngestionError(
            code=IngestionErrorCode.TRANSIENT_EXTERNAL_ERROR,
            message="retry me",
            retryable=True,
        )


class FatalPipeline:
    async def process(self, raw_payload: dict, queue_job_id: str) -> dict:
        raise IngestionError(
            code=IngestionErrorCode.FILE_PARSE_FAILED,
            message="do not retry",
            retryable=False,
        )


def build_settings() -> Settings:
    return Settings(
        database_url="postgresql://test:test@localhost:5432/test",
        s3_endpoint="http://localhost:9000",
        s3_bucket="test-bucket",
        aws_access_key_id="test-access",
        aws_secret_access_key="test-secret",
    )


@pytest.mark.asyncio
async def test_worker_consumer_returns_pipeline_result() -> None:
    consumer = IngestConsumer(build_settings(), SuccessfulPipeline())
    result = await consumer._process_job(FakeJob({"ingestJobId": "job-1"}), None)

    assert result["status"] == "completed"


@pytest.mark.asyncio
async def test_worker_consumer_rethrows_retryable_errors() -> None:
    consumer = IngestConsumer(build_settings(), RetryablePipeline())

    with pytest.raises(Exception) as exc_info:
        await consumer._process_job(FakeJob({"ingestJobId": "job-2"}), None)

    assert "retry me" in str(exc_info.value)


@pytest.mark.asyncio
async def test_worker_consumer_uses_unrecoverable_error_for_terminal_failures() -> None:
    consumer = IngestConsumer(build_settings(), FatalPipeline())

    with pytest.raises(Exception) as exc_info:
        await consumer._process_job(FakeJob({"ingestJobId": "job-3"}), None)

    assert "do not retry" in str(exc_info.value)
