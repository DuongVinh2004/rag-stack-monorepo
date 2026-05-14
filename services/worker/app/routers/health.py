from __future__ import annotations

from datetime import datetime, timezone
from time import perf_counter

from fastapi import APIRouter, HTTPException, Request

from app.core.logging import get_logger
from app.services.errors import IngestionError

router = APIRouter()
logger = get_logger("worker.health")


@router.get("/api/v1/health/live")
async def live() -> dict:
    return {
        "status": "ok",
        "service": "worker",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/api/v1/health/ready")
async def ready(request: Request) -> dict:
    checks: dict[str, dict[str, object]] = {}

    checks["database"] = await _run_check(
        lambda: _check_database(request),
    )
    if checks["database"]["status"] != "ok":
        raise _readiness_error("DATABASE_UNAVAILABLE", "database", checks)

    checks["redis"] = await _run_check(
        lambda: request.app.state.redis.ping(),
    )
    if checks["redis"]["status"] != "ok":
        raise _readiness_error("REDIS_UNAVAILABLE", "redis", checks)

    checks["object_storage"] = await _run_check(
        lambda: request.app.state.file_fetcher.check_bucket(request.app.state.settings.s3_bucket),
    )
    if checks["object_storage"]["status"] != "ok":
        raise _readiness_error("OBJECT_STORAGE_UNAVAILABLE", "object_storage", checks)

    consumer = getattr(request.app.state, "consumer", None)
    checks["consumer"] = {
        "status": "ok" if getattr(consumer, "is_running", False) else "failed",
        "queue_name": getattr(request.app.state.settings, "ingest_queue_name", None),
    }
    if checks["consumer"]["status"] != "ok":
        raise _readiness_error("WORKER_CONSUMER_NOT_READY", "consumer", checks)

    result = {
        "status": "ok",
        "service": "worker",
        "checks": checks,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    logger.info("Worker readiness passed", extra={"event": "health_ready", "checks": checks, "service": "worker"})
    return result


async def _check_database(request: Request) -> None:
    async with request.app.state.database.acquire() as connection:
        await connection.fetchval("SELECT 1")


async def _run_check(fn) -> dict[str, object]:
    started_at = perf_counter()
    try:
        await fn()
        return {
            "status": "ok",
            "latency_ms": round((perf_counter() - started_at) * 1000, 2),
        }
    except (IngestionError, Exception):
        return {
            "status": "failed",
            "latency_ms": round((perf_counter() - started_at) * 1000, 2),
        }


def _readiness_error(
    error_code: str,
    failed_dependency: str,
    checks: dict[str, dict[str, object]],
) -> HTTPException:
    logger.warning(
        "Worker readiness failed",
        extra={
            "event": "health_ready_failed",
            "error_code": error_code,
            "failed_dependency": failed_dependency,
            "checks": checks,
            "service": "worker",
        },
    )
    return HTTPException(
        status_code=503,
        detail={
            "status": "degraded",
            "service": "worker",
            "errorCode": error_code,
            "failedDependency": failed_dependency,
            "checks": checks,
        },
    )
