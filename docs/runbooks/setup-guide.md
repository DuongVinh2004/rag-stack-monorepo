# Setup Guide

This guide is for engineers who need a predictable local or demo-style boot flow.

## Choose a Run Mode

### Full demo stack

Use this when you want the quickest end-to-end path with the least host setup.

Includes:

- PostgreSQL + `pgvector`
- Redis
- MinIO
- API container
- worker container
- MinIO bucket bootstrap
- one-shot migration bootstrap
- one-shot demo seed bootstrap

Primary commands:

```bash
pnpm install
pnpm run demo:up
pnpm run demo:ps
pnpm run demo:logs
pnpm run demo:down
```

Use `pnpm run demo:reset` only when you intentionally want to delete demo volumes.

### Host-run API and worker

Use this when you want faster edit/run loops on the application services.

Primary commands:

```bash
pnpm install
pnpm run infra:up
pnpm run db:migrate
pnpm run db:seed
pnpm run db:seed:demo
pnpm run dev:api
pnpm run dev:worker
```

## Config Files to Review

Demo stack:

- [infra/compose/docker-compose.demo.yml](../../infra/compose/docker-compose.demo.yml)
- [infra/compose/demo.env.example](../../infra/compose/demo.env.example)
- `infra/compose/demo.env`

Host-run:

- [services/api/.env.example](../../services/api/.env.example)
- [services/worker/.env.example](../../services/worker/.env.example)

## Environment Variables

### Always required

API:

- `DATABASE_URL`
- `JWT_SECRET`
- `REDIS_HOST`
- `REDIS_PORT`
- `S3_ENDPOINT`
- `S3_BUCKET`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`

Worker:

- `DATABASE_URL`
- `REDIS_HOST`
- `REDIS_PORT`
- `S3_ENDPOINT`
- `S3_BUCKET`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`

### OpenAI-related

Optional but operationally important:

- `OPENAI_API_KEY`
- `OPENAI_GROUNDED_CHAT_ENABLED`
- `OPENAI_EMBEDDINGS_ENABLED`
- `OPENAI_CHAT_MODEL`
- `OPENAI_EMBEDDING_MODEL`
- `OPENAI_REQUEST_TIMEOUT_MS`
- `OPENAI_MAX_RETRIES`
- `OPENAI_RETRY_BASE_DELAY_MS`
- `OPENAI_GROUNDED_CHAT_MAX_CHUNKS`
- `OPENAI_TEMPERATURE`
- `OPENAI_EMBEDDING_BATCH_SIZE`
- `OPENAI_EMBEDDING_BATCH_TOKEN_LIMIT`

Fallback behavior:

- missing key or disabled embeddings: ingestion continues without vectors, retrieval falls back to lexical-only
- missing key or grounded chat disabled: `/chat/ask` and eval answer generation fail cleanly with `503`

### Demo seed overrides

- `DEMO_ADMIN_EMAIL`
- `DEMO_ADMIN_PASSWORD`
- `DEMO_EDITOR_EMAIL`
- `DEMO_EDITOR_PASSWORD`
- `DEMO_VIEWER_EMAIL`
- `DEMO_VIEWER_PASSWORD`
- `DEMO_KB_NAME`
- `DEMO_KB_DESCRIPTION`
- `DEMO_KB_VISIBILITY`
- `DEMO_EVAL_SET_NAME`

## Migration and Seed Flow

### Safe defaults

```bash
pnpm run db:migrate
pnpm run db:seed
pnpm run db:seed:demo
pnpm run db:verify
```

What they do:

- `db:migrate`
  - runs Prisma `migrate deploy`
- `db:seed`
  - seeds system roles only
- `db:seed:demo`
  - upserts demo admin, editor, viewer
  - upserts demo KB
  - upserts memberships
  - upserts smoke eval set and case
- `db:verify`
  - applies migrations into an isolated temporary schema
  - reruns seeds
  - checks uniqueness, FK, and restrict behavior at the database level

### Schema-change workflow

Only use this when authoring new migrations:

```bash
pnpm run db:migrate:dev
```

### Demo stack equivalents

`pnpm run demo:up` already runs migrations and the demo seed.

Manual reruns:

```bash
pnpm run demo:migrate
pnpm run demo:seed
```

## Seeded Local Data

Default seed output:

- admin: `demo-admin@example.com`
- editor: `demo-editor@example.com`
- viewer: `demo-viewer@example.com`
- password for all three: `DemoPass1234`
- KB: `Support Demo KB`
- eval set: `Support Smoke Eval`

## Readiness and Health

Verify:

- API live: `GET /api/v1/health/live`
- API ready: `GET /api/v1/health/ready`
- Worker live: `GET http://localhost:8000/api/v1/health/live`
- Worker ready: `GET http://localhost:8000/api/v1/health/ready`

Readiness checks validate:

- PostgreSQL
- Redis
- object storage
- worker readiness also checks that the ingest consumer started successfully

## Reviewer Smoke Checks

1. `pnpm run demo:up`
2. `pnpm run demo:ps`
3. verify API and worker readiness
4. log in as the seeded admin
5. upload [docs/demo/sample-support-runbook.txt](../demo/sample-support-runbook.txt)
6. wait for document status `INDEXED`
7. ask `How do I reset the worker?`
8. inspect citations
9. run the seeded eval set or create a small new one

## Useful Validation Commands

```bash
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run db:verify
pnpm run compose:config
pnpm run docker:build
```

## Troubleshooting

- API not ready: verify PostgreSQL, Redis, and MinIO health first.
- Worker not ready: verify object storage settings and Redis connectivity.
- Uploads fail: confirm bucket bootstrap ran and `S3_BUCKET` matches the bucket created by `minio-init`.
- Chat returns `503`: verify `OPENAI_API_KEY` and grounded chat flags.
- Semantic retrieval missing: verify embeddings were enabled before indexing and reindex if necessary.
- Demo reset needed: use `pnpm run demo:reset`, then `pnpm run demo:up`.

## Related Docs

- [Demo Walkthrough](./demo-walkthrough.md)
- [Incident Runbook](./incidents.md)
- [Release Gate](./release-gate.md)
