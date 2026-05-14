from __future__ import annotations

import json
import sys

from fastapi import FastAPI

from app.core.db import Database
from app.core.logging import configure_logging, get_logger
from app.core.redis import RedisManager
from app.core.settings import Settings, get_settings
from app.routers.health import router as health_router
from app.services.chunker import Chunker
from app.services.embedder import Embedder
from app.services.file_fetcher import FileFetcher
from app.services.indexer import Indexer
from app.services.ingest_pipeline import IngestPipeline
from app.services.normalizer import TextNormalizer
from app.services.parsers.factory import ParserFactory
from app.services.status_manager import StatusManager
from app.services.token_counter import TokenCounter
from app.workers.ingest_consumer import IngestConsumer


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level)
    logger = get_logger("worker.app")

    app = FastAPI(title=settings.app_name)
    app.include_router(health_router)

    @app.on_event("startup")
    async def startup_event() -> None:
        try:
            database = Database(settings.database_url)
            redis = RedisManager(settings.redis_host, settings.redis_port)
            file_fetcher = FileFetcher(settings)
            token_counter = TokenCounter()
            normalizer = TextNormalizer()
            chunker = Chunker(settings, token_counter, normalizer)
            embedder = Embedder(settings, token_counter)
            status_manager = StatusManager(database, embeddings_enabled=embedder.enabled)
            indexer = Indexer(database)
            parser_factory = ParserFactory()
            pipeline = IngestPipeline(
                status_manager=status_manager,
                file_fetcher=file_fetcher,
                parser_factory=parser_factory,
                normalizer=normalizer,
                chunker=chunker,
                embedder=embedder,
                indexer=indexer,
            )
            consumer = IngestConsumer(settings, pipeline)

            logger.info(
                "Validated worker configuration",
                extra={
                    "event": "startup_validated",
                    "runtime_summary": settings.safe_runtime_summary(),
                },
            )

            await database.connect()
            await redis.ping()
            await file_fetcher.check_bucket(settings.s3_bucket)
            await consumer.start()

            app.state.settings = settings
            app.state.database = database
            app.state.redis = redis
            app.state.file_fetcher = file_fetcher
            app.state.consumer = consumer

            logger.info(
                "Worker startup complete",
                extra={
                    "event": "startup_complete",
                    "consumer_running": consumer.is_running,
                    "queue_name": settings.ingest_queue_name,
                },
            )
        except Exception:
            logger.exception("Worker startup failed", extra={"event": "startup_failed"})
            raise

    @app.on_event("shutdown")
    async def shutdown_event() -> None:
        consumer = getattr(app.state, "consumer", None)
        database = getattr(app.state, "database", None)
        redis = getattr(app.state, "redis", None)

        if consumer is not None:
            await consumer.stop()
        if database is not None:
            await database.disconnect()
        if redis is not None:
            await redis.disconnect()

        logger.info("Worker shutdown complete", extra={"event": "shutdown_complete"})

    return app

try:
    app = create_app()
except Exception as exc:  # pragma: no cover - process startup path
    sys.stderr.write(
        json.dumps(
            {
                "event": "worker_startup_failed",
                "error_code": "STARTUP_FAILED",
                "message": str(exc),
            }
        )
        + "\n"
    )
    raise
