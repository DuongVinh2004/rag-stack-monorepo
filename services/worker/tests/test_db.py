from app.core.db import sanitize_asyncpg_database_url


def test_sanitize_asyncpg_database_url_strips_schema_query_param() -> None:
    database_url = "postgresql://user:pass@localhost:5432/app?schema=public&sslmode=disable"

    assert sanitize_asyncpg_database_url(database_url) == "postgresql://user:pass@localhost:5432/app?sslmode=disable"


def test_sanitize_asyncpg_database_url_keeps_urls_without_query_string() -> None:
    database_url = "postgresql://user:pass@localhost:5432/app"

    assert sanitize_asyncpg_database_url(database_url) == database_url
