# RAG Backend - Knowledge Base and Support Copilot API

A portfolio-grade backend for a knowledge base and support copilot workflow: authentication, KB-scoped access, async ingestion, retrieval, grounded chat with citations, conversations, evals, ops endpoints, and health checks.

This repo is built to be reviewed and run locally. It is not positioned as a hardened SaaS deployment.

## Stack

| Layer | Technology |
|-------|------------|
| API | NestJS, TypeScript, Prisma, JWT |
| Worker | FastAPI, Python |
| Data | PostgreSQL with pgvector |
| Queue | Redis and BullMQ |
| Object storage | S3-compatible storage, MinIO in compose |
| Answer generation | OpenAI when configured, bounded local extractive fallback for demo chat |

## What is implemented

- Auth: login, refresh, logout, profile lookup
- Authorization: system roles plus KB-local roles
- Knowledge bases: create, list, update, membership management
- Documents: upload to object storage, document version tracking, ingest jobs, reindex
- Worker ingestion: fetch, parse, normalize, chunk, embed when available, persist chunks
- Retrieval: semantic plus lexical retrieval with KB-scoped SQL filtering
- Chat: grounded answers with citations, persisted conversations, history retrieval
- Evals: operator/admin eval sets and runs
- Ops: failed ingest jobs, retry, metrics snapshot
- Health: `/health/live` and `/health/ready` on API and worker
- Demo fixtures: seeded users, multiple KBs, seeded documents, smoke verifier

## Repo layout

```text
services/api/          NestJS API
services/worker/       FastAPI ingestion worker
packages/shared-types/ Shared TS queue contracts
infra/compose/         Docker Compose for infra-only and full demo
docs/                  Architecture, runbooks, quickstart, demo fixtures
tests/e2e/             Live-stack smoke verifier
```

## Quickstart

Fast path: [docs/quickstart.md](docs/quickstart.md)

Full demo walkthrough: [docs/runbooks/demo-walkthrough.md](docs/runbooks/demo-walkthrough.md)

### Full demo stack

```bash
pnpm install
pnpm run demo:up
pnpm run demo:ps
```

`demo:up` starts Postgres, Redis, MinIO, the API, the worker, migrations, and the demo seed.

Basic grounded chat works with the seeded fixtures even if `OPENAI_API_KEY` is blank. Set `OPENAI_API_KEY` in `infra/compose/demo.env` if you want semantic retrieval and eval answer generation.

Useful commands:

- `pnpm run demo:logs`
- `pnpm run demo:down`
- `pnpm run demo:reset`
- `pnpm run test:demo:smoke`

### Infra only with services on the host

```bash
pnpm install
pnpm run infra:up
pnpm run db:migrate
pnpm run db:seed
pnpm run db:seed:demo
pnpm run dev:api
pnpm run dev:worker
```

Env templates:

- [services/api/.env.example](services/api/.env.example)
- [services/worker/.env.example](services/worker/.env.example)
- [infra/compose/demo.env.example](infra/compose/demo.env.example)

## Migrations and seed

| Command | Purpose |
|---------|---------|
| `pnpm run db:migrate` | Deploy Prisma migrations |
| `pnpm run db:migrate:dev` | Create a development migration |
| `pnpm run db:migrate:status` | Show migration status |
| `pnpm run db:seed` | Seed system roles |
| `pnpm run db:seed:demo` | Seed demo users, KBs, sample documents, ingest jobs, and eval fixtures |
| `pnpm run db:verify` | Verify schema expectations |

Docker equivalents:

- `pnpm run demo:migrate`
- `pnpm run demo:seed`

## Seeded demo data

Accounts:

- `demo-admin@example.com` / `DemoPass1234`
- `demo-editor@example.com` / `DemoPass1234`
- `demo-viewer@example.com` / `DemoPass1234`
- `demo-user@example.com` / `DemoPass1234`

Knowledge bases:

- `Support Demo KB`
  - preloaded with four support documents for immediate retrieval and citation demos
- `Upload Sandbox KB`
  - starts empty for the upload lifecycle demo
- `Restricted Admin KB`
  - admin-only KB for access-control smoke checks

Preloaded support documents:

- `Worker Recovery Runbook`
- `Escalation Evidence Checklist`
- `Queue Backlog Playbook`
- `Account Reset Playbook`

Upload fixture:

- [docs/demo/sample-support-runbook.txt](docs/demo/sample-support-runbook.txt)

Fixture index and sample questions:

- [docs/demo/README.md](docs/demo/README.md)

## Core verification flow

1. `GET /api/v1/health/ready` and worker `GET /api/v1/health/ready`
2. `POST /api/v1/auth/login`
3. `GET /api/v1/knowledge-bases`
4. `GET /api/v1/documents?kbId=<support-kb-id>`
5. `POST /api/v1/chat/ask`
6. `GET /api/v1/conversations`
7. `POST /api/v1/documents/upload` into `Upload Sandbox KB`
8. `GET /api/v1/documents/:id` until `INDEXED`
9. `pnpm run test:demo:smoke`

Swagger UI: `http://localhost:3000/api/v1/docs`

## Service URLs

| Service | URL |
|---------|-----|
| API | <http://localhost:3000/api/v1> |
| Swagger | <http://localhost:3000/api/v1/docs> |
| API health | <http://localhost:3000/api/v1/health/live> and `/ready` |
| Worker health | <http://localhost:8000/api/v1/health/live> and `/ready` |
| MinIO console | <http://localhost:9001> |

## Smoke verifier

After `demo:up`:

```bash
pnpm run test:demo:smoke
```

The smoke script performs a live-stack check of:

- login
- KB discovery
- seeded document indexing
- grounded chat with citations
- conversation persistence
- upload to the sandbox KB
- worker-driven indexing

## Development commands

| Command | Purpose |
|---------|---------|
| `pnpm run bootstrap` | Install deps, generate Prisma client, install worker deps |
| `pnpm run build` | Build shared package and API |
| `pnpm run lint` | Lint API code |
| `pnpm run typecheck` | Type-check API code |
| `pnpm run test` | API unit tests, API e2e tests, and worker tests |
| `pnpm run test:api` | API unit tests |
| `pnpm run test:api:e2e` | API integration tests (slim mocked app) |
| `pnpm run test:workflow` | Root-level HTTP integration tests (guards, validation, CORS) |
| `pnpm run test:worker` | Worker pytest suite |
| `pnpm run test:demo:smoke` | Live demo-stack smoke verification |

## Documentation map

- [docs/README.md](docs/README.md)
- [docs/quickstart.md](docs/quickstart.md)
- [docs/runbooks/demo-walkthrough.md](docs/runbooks/demo-walkthrough.md)
- [docs/architecture/overview.md](docs/architecture/overview.md)
- [docs/architecture/flow.md](docs/architecture/flow.md)
- [docs/architecture/access-control.md](docs/architecture/access-control.md)
- [docs/architecture/observability.md](docs/architecture/observability.md)
- [docs/feature-matrix.md](docs/feature-matrix.md)

## Known limitations

- Compose is for local and demo use, not a production deployment story.
- OpenAI is still the only provider-backed path for embeddings and eval answer generation.
- Chat has a bounded local extractive fallback for demo/local use, not a second general-purpose LLM provider.
- Metrics are in-process snapshots, not a built-in Prometheus endpoint.
- Tracing is a placeholder, not full OpenTelemetry.
- OCR and sentence-level citation alignment are out of scope.
- Eval runs are synchronous and sized for smoke and regression checks, not large offline batch execution.

## Troubleshooting

- `demo:up` stalls: `pnpm run demo:ps`, `pnpm run demo:logs`
- readiness returns `503`: check Postgres, Redis, MinIO credentials, and bucket creation
- seeded docs stay queued: confirm the worker health endpoint and queue connectivity
- chat quality is weak: confirm the support docs reached `INDEXED`; add `OPENAI_API_KEY` if you want semantic retrieval
- evals return `503`: set `OPENAI_API_KEY`
- Docker daemon errors: run `docker info` before assuming repo issues

## Web frontend

The `services/web` directory contains a React + Vite admin interface.

```bash
npx pnpm run demo:up          # Start the full backend stack
npx pnpm --filter web run dev # Start the frontend dev server
```

Open `http://localhost:5173` and use any demo account to log in. See the **Seeded demo data** section above for credentials.
