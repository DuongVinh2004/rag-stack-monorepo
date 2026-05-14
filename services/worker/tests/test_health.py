from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.routers.health import ready


class _FakeConnection:
    async def fetchval(self, query: str):
        return 1


class _AcquireContext:
    async def __aenter__(self):
        return _FakeConnection()

    async def __aexit__(self, exc_type, exc, tb):
        return False


class _Database:
    def acquire(self):
        return _AcquireContext()


class _Redis:
    def __init__(self, should_fail: bool = False) -> None:
        self.should_fail = should_fail

    async def ping(self):
        if self.should_fail:
            raise RuntimeError("redis down")
        return True


class _FileFetcher:
    def __init__(self, should_fail: bool = False) -> None:
        self.should_fail = should_fail

    async def check_bucket(self, bucket: str):
        if self.should_fail:
            raise RuntimeError("bucket down")


def _request(consumer_running: bool = True, redis_fail: bool = False):
    app = SimpleNamespace(
        state=SimpleNamespace(
            database=_Database(),
            redis=_Redis(should_fail=redis_fail),
            file_fetcher=_FileFetcher(),
            settings=SimpleNamespace(s3_bucket="test-bucket", ingest_queue_name="ingest_jobs"),
            consumer=SimpleNamespace(is_running=consumer_running),
        )
    )
    return SimpleNamespace(app=app)


@pytest.mark.asyncio
async def test_worker_ready_reports_dependency_and_consumer_status() -> None:
    result = await ready(_request())

    assert result["status"] == "ok"
    assert result["checks"]["database"]["status"] == "ok"
    assert result["checks"]["redis"]["status"] == "ok"
    assert result["checks"]["object_storage"]["status"] == "ok"
    assert result["checks"]["consumer"]["status"] == "ok"


@pytest.mark.asyncio
async def test_worker_ready_fails_when_consumer_not_running() -> None:
    with pytest.raises(HTTPException) as exc_info:
        await ready(_request(consumer_running=False))

    assert exc_info.value.status_code == 503
    assert exc_info.value.detail["errorCode"] == "WORKER_CONSUMER_NOT_READY"
    assert exc_info.value.detail["failedDependency"] == "consumer"


@pytest.mark.asyncio
async def test_worker_ready_fails_when_dependency_is_unavailable() -> None:
    with pytest.raises(HTTPException) as exc_info:
        await ready(_request(redis_fail=True))

    assert exc_info.value.status_code == 503
    assert exc_info.value.detail["errorCode"] == "REDIS_UNAVAILABLE"
    assert exc_info.value.detail["checks"]["redis"]["status"] == "failed"
