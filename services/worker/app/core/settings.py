from functools import lru_cache
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

from pydantic import AliasChoices, Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parents[2] / ".env",
        extra="ignore",
        populate_by_name=True,
    )

    app_name: str = "RAG Backend Worker"
    environment: str = "development"
    log_level: str = "INFO"

    database_url: str = Field(alias="DATABASE_URL")
    redis_host: str = Field(default="localhost", alias="REDIS_HOST")
    redis_port: int = Field(default=6379, alias="REDIS_PORT")

    s3_endpoint: str = Field(alias="S3_ENDPOINT")
    s3_bucket: str = Field(alias="S3_BUCKET")
    s3_region: str = Field(default="us-east-1", alias="S3_REGION")
    aws_access_key_id: str = Field(alias="AWS_ACCESS_KEY_ID")
    aws_secret_access_key: str = Field(alias="AWS_SECRET_ACCESS_KEY")

    openai_api_key: Optional[str] = Field(default=None, alias="OPENAI_API_KEY")
    openai_embedding_model: str = Field(default="text-embedding-3-small", alias="OPENAI_EMBEDDING_MODEL")
    openai_embeddings_enabled: bool = Field(default=True, alias="OPENAI_EMBEDDINGS_ENABLED")
    openai_request_timeout_ms: int = Field(default=30000, alias="OPENAI_REQUEST_TIMEOUT_MS")
    openai_max_retries: int = Field(default=2, alias="OPENAI_MAX_RETRIES")
    openai_retry_base_delay_ms: int = Field(default=250, alias="OPENAI_RETRY_BASE_DELAY_MS")
    openai_embedding_batch_size: int = Field(
        default=32,
        validation_alias=AliasChoices("OPENAI_EMBEDDING_BATCH_SIZE", "EMBEDDING_BATCH_SIZE"),
    )
    openai_embedding_batch_token_limit: int = Field(
        default=12000,
        validation_alias=AliasChoices(
            "OPENAI_EMBEDDING_BATCH_TOKEN_LIMIT",
            "EMBEDDING_BATCH_TOKEN_LIMIT",
        ),
    )

    ingest_queue_name: str = Field(default="ingest_jobs", alias="INGEST_QUEUE_NAME")
    worker_concurrency: int = Field(default=2, alias="WORKER_CONCURRENCY")
    ingest_max_attempts: int = Field(default=3, alias="INGEST_MAX_ATTEMPTS")

    chunk_target_tokens: int = Field(default=800, alias="CHUNK_TARGET_TOKENS")
    chunk_overlap_tokens: int = Field(default=120, alias="CHUNK_OVERLAP_TOKENS")
    chunking_strategy: str = Field(default="section_aware", alias="CHUNKING_STRATEGY")
    chunking_version: str = Field(default="section_v2", alias="CHUNKING_VERSION")

    @model_validator(mode="after")
    def validate_security_and_bounds(self) -> "Settings":
        if self.log_level.upper() not in {"CRITICAL", "ERROR", "WARNING", "INFO", "DEBUG"}:
            raise ValueError("LOG_LEVEL must be one of CRITICAL, ERROR, WARNING, INFO, DEBUG")
        if self.worker_concurrency < 1 or self.worker_concurrency > 16:
            raise ValueError("WORKER_CONCURRENCY must be between 1 and 16")
        if self.ingest_max_attempts < 1 or self.ingest_max_attempts > 10:
            raise ValueError("INGEST_MAX_ATTEMPTS must be between 1 and 10")
        if self.chunk_target_tokens < 20:
            raise ValueError("CHUNK_TARGET_TOKENS must be at least 20")
        if self.chunk_overlap_tokens < 0 or self.chunk_overlap_tokens >= self.chunk_target_tokens:
            raise ValueError("CHUNK_OVERLAP_TOKENS must be non-negative and smaller than CHUNK_TARGET_TOKENS")
        if self.openai_request_timeout_ms < 1000 or self.openai_request_timeout_ms > 180000:
            raise ValueError("OPENAI_REQUEST_TIMEOUT_MS must be between 1000 and 180000")
        if self.openai_max_retries < 0 or self.openai_max_retries > 5:
            raise ValueError("OPENAI_MAX_RETRIES must be between 0 and 5")
        if self.openai_retry_base_delay_ms < 0 or self.openai_retry_base_delay_ms > 5000:
            raise ValueError("OPENAI_RETRY_BASE_DELAY_MS must be between 0 and 5000")
        if self.openai_embedding_batch_size < 1 or self.openai_embedding_batch_size > 256:
            raise ValueError("OPENAI_EMBEDDING_BATCH_SIZE must be between 1 and 256")
        if self.openai_embedding_batch_token_limit < 1 or self.openai_embedding_batch_token_limit > 60000:
            raise ValueError("OPENAI_EMBEDDING_BATCH_TOKEN_LIMIT must be between 1 and 60000")
        parsed_endpoint = urlparse(self.s3_endpoint)
        if parsed_endpoint.scheme not in {"http", "https"} or not parsed_endpoint.netloc:
            raise ValueError("S3_ENDPOINT must be a valid http or https URL")
        return self

    def safe_runtime_summary(self) -> dict[str, object]:
        return {
            "environment": self.environment,
            "log_level": self.log_level.upper(),
            "database_configured": bool(self.database_url),
            "redis_host": self.redis_host,
            "redis_port": self.redis_port,
            "object_storage_configured": bool(self.s3_bucket and self.s3_endpoint),
            "object_storage_bucket": self.s3_bucket,
            "embeddings_enabled": bool(self.openai_api_key) and self.openai_embeddings_enabled,
            "embedding_model": self.openai_embedding_model,
            "queue_name": self.ingest_queue_name,
            "worker_concurrency": self.worker_concurrency,
            "chunking_strategy": self.chunking_strategy,
            "chunking_version": self.chunking_version,
        }


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
