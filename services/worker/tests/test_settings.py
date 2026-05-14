from pathlib import Path

import pytest

from app.core.settings import Settings


def test_settings_load_worker_env_file_from_any_cwd(monkeypatch) -> None:
    repo_root = Path(__file__).resolve().parents[3]
    monkeypatch.chdir(repo_root)

    for name in [
        "DATABASE_URL",
        "S3_ENDPOINT",
        "S3_BUCKET",
        "AWS_ACCESS_KEY_ID",
        "AWS_SECRET_ACCESS_KEY",
    ]:
        monkeypatch.delenv(name, raising=False)

    settings = Settings()

    assert settings.database_url
    assert settings.s3_bucket == "knowledge-base-bucket"


def test_settings_accept_openai_runtime_tuning(monkeypatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql://test:test@localhost:5432/test")
    monkeypatch.setenv("S3_ENDPOINT", "http://localhost:9000")
    monkeypatch.setenv("S3_BUCKET", "test-bucket")
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "test-access")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "test-secret")
    monkeypatch.setenv("OPENAI_REQUEST_TIMEOUT_MS", "45000")
    monkeypatch.setenv("OPENAI_MAX_RETRIES", "4")
    monkeypatch.setenv("OPENAI_RETRY_BASE_DELAY_MS", "500")
    monkeypatch.setenv("OPENAI_EMBEDDING_BATCH_SIZE", "16")

    settings = Settings(_env_file=None)

    assert settings.openai_request_timeout_ms == 45000
    assert settings.openai_max_retries == 4
    assert settings.openai_retry_base_delay_ms == 500
    assert settings.openai_embedding_batch_size == 16


def test_settings_reject_invalid_openai_retry_bounds(monkeypatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql://test:test@localhost:5432/test")
    monkeypatch.setenv("S3_ENDPOINT", "http://localhost:9000")
    monkeypatch.setenv("S3_BUCKET", "test-bucket")
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "test-access")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "test-secret")
    monkeypatch.setenv("OPENAI_MAX_RETRIES", "8")

    with pytest.raises(ValueError, match="OPENAI_MAX_RETRIES"):
        Settings(_env_file=None)


def test_settings_expose_safe_runtime_summary(monkeypatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql://test:test@localhost:5432/test")
    monkeypatch.setenv("S3_ENDPOINT", "http://localhost:9000")
    monkeypatch.setenv("S3_BUCKET", "test-bucket")
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "test-access")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "test-secret")
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")

    settings = Settings(_env_file=None)
    summary = settings.safe_runtime_summary()

    assert summary["database_configured"] is True
    assert summary["object_storage_bucket"] == "test-bucket"
    assert summary["embeddings_enabled"] is True
