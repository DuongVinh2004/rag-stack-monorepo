# Demo and Staging Release Gate

Use this checklist before a demo or staging cut. It is a practical verification list, not a promise of full production readiness.

For health and logging semantics, see [observability](../architecture/observability.md).

## Environment and Configuration

- required API env vars are present:
  - `DATABASE_URL`
  - `JWT_SECRET`
  - `REDIS_HOST`
  - `REDIS_PORT`
  - `S3_ENDPOINT`
  - `S3_BUCKET`
  - `AWS_ACCESS_KEY_ID`
  - `AWS_SECRET_ACCESS_KEY`
- required worker env vars are present:
  - `DATABASE_URL`
  - `REDIS_HOST`
  - `REDIS_PORT`
  - `S3_ENDPOINT`
  - `S3_BUCKET`
  - `AWS_ACCESS_KEY_ID`
  - `AWS_SECRET_ACCESS_KEY`
- `OPENAI_API_KEY` is present if the demo expects semantic retrieval or grounded chat
- startup logs show `api_startup_validated` and `startup_validated`

## Infrastructure and Services

- PostgreSQL is reachable
- Redis is reachable
- object storage is reachable and the configured bucket exists
- migrations are applied
- system roles are seeded
- demo seed data is loaded if the demo depends on it

## Health and Readiness

- API `GET /api/v1/health/live` returns `200`
- API `GET /api/v1/health/ready` returns `200`
- worker `GET /api/v1/health/live` returns `200`
- worker `GET /api/v1/health/ready` returns `200`
- worker readiness reports `checks.consumer.status = ok`

Important:

- readiness proves core dependency availability only
- readiness does not prove OpenAI availability or answer quality

## Functional Smoke Checks

- sample upload works
- ingestion job reaches `COMPLETED`
- document reaches `INDEXED`
- sample grounded chat returns citations
- sample out-of-scope chat returns refusal without citations
- sample eval run completes successfully
- failed-job retry path works if intentionally exercised

## Operator and Debuggability Checks

- `GET /api/v1/ops/metrics` returns metrics snapshot and ingestion counts
- `GET /api/v1/ops/jobs/failed` works for operator/admin users
- logs contain `correlation_id` on request-scoped events
- worker logs include `job_id` and `queue_job_id`
- chat logs include `stage_timings_ms`
- ingest logs include `ingest_timings_ms`

## Suggested Demo Flow

1. Bring the environment up.
2. Confirm API and worker readiness.
3. Log in as the seeded admin.
4. Upload the sample runbook.
5. Wait for the document to become `INDEXED`.
6. Ask one grounded support question and verify citations.
7. Ask one clearly out-of-scope question and verify refusal behavior.
8. Run the smoke eval set.
9. Check `GET /api/v1/ops/metrics`.

## Known Limitations to Acknowledge

- no Prometheus endpoint
- no distributed tracing backend
- no queue-depth dashboards
- no sentence-level citation grader
- readiness does not validate OpenAI availability
- evals are synchronous smoke/regression runs, not benchmark infrastructure

## Safe Go/No-Go Rule

Proceed only if:

- health and readiness are green
- upload and ingestion work
- grounded chat returns citations
- refusal behavior is sane
- the smoke eval run does not show unexpected regressions

Pause the demo or release if:

- readiness is degraded
- worker consumer is not running
- ingestion is failing repeatedly
- citations are missing on grounded answers
- eval regression is unexplained
