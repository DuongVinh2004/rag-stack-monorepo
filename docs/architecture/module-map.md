# Module map

High-level map of where code lives. Details stay in source; this is for reviewer orientation.

## API (`services/api`) — NestJS

| Area | Path (under `src/`) | Responsibility |
|------|---------------------|----------------|
| Bootstrap | `main.ts`, `app.module.ts` | Prefix `api/v1`, CORS, validation, Swagger, correlation middleware |
| Auth | `auth/` | JWT login/refresh, guards |
| Authorization | `common/authorization/` | KB membership, document/conversation scope |
| Knowledge bases | `knowledge-bases/` | KB CRUD, membership |
| Documents | `documents/` | Upload, reindex, enqueue BullMQ ingest jobs |
| Chat | `chat/` | Ask, retrieval, prompts, citations, persistence |
| OpenAI | `openai/` | Embeddings, grounded chat gateway, error mapping |
| Evals | `evals/` | Eval sets/runs (operator/admin roles) |
| Ops | `ops/` | Failed jobs, retry, metrics snapshot |
| Health | `health/` | Live vs readiness (DB, Redis, S3) |
| Observability | `common/observability/` | JSON logger, metrics, tracing stub, request logging |
| Storage | `common/storage/` | S3-compatible uploads |
| Prisma | `prisma/` | DB access |

## Worker (`services/worker`) — FastAPI

| Area | Path | Responsibility |
|------|------|----------------|
| App | `app/main.py`, routers | HTTP server, health routes |
| Consumer | `app/workers/ingest_consumer.py` | BullMQ worker consumer |
| Pipeline | `app/services/ingest_pipeline.py` | Fetch → parse → normalize → chunk → embed → persist |
| Indexing | `app/services/indexer.py` | Writes chunks to PostgreSQL |
| Infra helpers | `app/core/` | Settings, DB pool, Redis, logging |

## Shared contracts

| Package | Role |
|---------|------|
| `packages/shared-types` | Shared enums and ingest queue payload types for API/worker alignment |
