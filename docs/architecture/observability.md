# Observability

This project has practical observability, not a full enterprise monitoring stack.

The goal is simple:

- let another engineer understand what the system is doing
- show where requests and jobs fail
- expose the major latency stages
- make health and readiness actionable
- leave clear extension points for future metrics and tracing

## Logging Conventions

### Field contract

New structured logs use these field conventions:

- `event`
  - stable machine-oriented event name
- `correlation_id`
  - request or job correlation key
- `request_id`
  - HTTP request identifier; mirrors `correlation_id` today
- `job_id`
  - ingestion job id
- `queue_job_id`
  - BullMQ transport job id
- entity identifiers when relevant:
  - `kb_id`
  - `document_id`
  - `document_version_id`
  - `conversation_id`
  - `user_message_id`
  - `assistant_message_id`
  - `message_id`
- timing fields in milliseconds:
  - `latency_ms`
  - `duration_ms`
  - `timings_ms`
  - `stage_timings_ms`
  - `ingest_timings_ms`
- safe failure fields:
  - `error_code`
  - `status_code`
  - `retryable`
  - `failed_dependency`

### API logging behavior

- all HTTP requests receive `x-correlation-id` and `x-request-id`
- if a valid `x-correlation-id` is supplied, the API reuses it
- otherwise the API generates a UUID
- request completion is logged once per request
- exception responses log safe metadata without dumping sensitive content

The API `JsonLogger` also:

- redacts sensitive keys such as tokens, secrets, passwords, prompts, instructions, and raw input payloads
- normalizes keys to `snake_case`
- parses legacy JSON-string log payloads so older call sites still land as structured JSON

### Worker logging behavior

- logs are JSON structured
- extra keys are normalized to `snake_case`
- consumer lifecycle logs include queue name and concurrency
- each ingested job now logs:
  - `worker_job_received`
  - `worker_job_completed`
  - `worker_job_retryable_failure` or `worker_job_terminal_failure`
- ingestion stage logs include:
  - `correlation_id`
  - `kb_id`
  - `document_id`
  - `document_version_id`
  - `ingest_job_id`
  - `job_id`
  - `queue_job_id`
  - `pipeline_version`
  - `ingest_version`

### Log levels

- `info`
  - normal lifecycle transitions
  - startup summaries
  - readiness success
  - retrieval completion
  - chat completion
  - ingest stage completion
- `warn`
  - handled degradation
  - dependency readiness failure
  - retry scheduling
  - citation chunk rejection
  - request failures in the 4xx class
- `error`
  - request failures in the 5xx class
  - unhandled exceptions
  - integrity violations
  - ingest pipeline failures
  - startup failure

### Never log

- secrets, API keys, bearer tokens, JWTs, passwords
- raw prompts or full prompt instructions
- large raw document bodies
- arbitrary user or KB content dumps
- raw storage object keys when a hash is sufficient

## Health and Readiness

### Endpoints

API:

- `GET /api/v1/health/live`
- `GET /api/v1/health/ready`

Worker:

- `GET /api/v1/health/live`
- `GET /api/v1/health/ready`

### Liveness semantics

`/health/live` means the process is running. It does not validate dependencies.

### Readiness semantics

API readiness requires all of these to pass:

- database
- Redis
- object storage bucket check

Worker readiness requires all of these to pass:

- database
- Redis
- object storage bucket check
- worker consumer started

The readiness response includes per-check latency. Example shape:

```json
{
  "status": "ok",
  "service": "api",
  "checks": {
    "database": { "status": "ok", "latencyMs": 3 },
    "redis": { "status": "ok", "latencyMs": 2 },
    "objectStorage": { "status": "ok", "latencyMs": 8 }
  }
}
```

On failure, readiness returns `503` with:

- `errorCode`
- `failedDependency`
- partial `checks`

### What readiness does not mean

Readiness intentionally does not prove:

- OpenAI is reachable
- queue backlog is healthy
- retrieval quality is good
- eval quality is acceptable

Those are operational concerns, not binary dependency checks.

## Stage Timing Coverage

### Chat path

Successful chat outcome logs include `stage_timings_ms` with:

- `auth_scope_ms`
- `conversation_setup_ms`
- `indexed_chunk_count_ms`
- `retrieval_wall_ms`
- `retrieval.embedding_ms`
- `retrieval.semantic_fetch_ms`
- `retrieval.lexical_fetch_ms`
- `retrieval.merge_rerank_ms`
- `retrieval.dedup_ms`
- `retrieval.total_ms`
- `history_ms`
- `prompt_assembly_ms`
- `model_generation_ms`
- `citation_assembly_ms`
- `persist_ms`

Retrieval also emits its own `retrieval_completed` log with candidate counts and stage timings.

OpenAI calls emit:

- `openai_request_completed`
- `openai_request_failed`
- `openai_request_retry_scheduled`

### Ingestion path

Worker ingestion logs now cover:

- `object_fetch_ms`
- `parse_ms`
- `normalize_ms`
- `chunk_ms`
- `embed_ms`
- `persist_ms`
- `total_ms`

These appear in `ingest_timings_ms` on:

- `ingest_completed`
- `ingest_failed`

The worker also logs stage-by-stage lifecycle events:

- `file_fetched`
- `document_parsed`
- `document_normalized`
- `document_chunked`
- `embeddings_generated`
- `chunks_persisted`

## Metrics and Tracing Extension Points

### API

The API uses `MetricsService` as the single emission surface for in-process counters and duration samples.

Current useful metric families include:

- `http_requests_total`
- `http_request_duration_ms`
- `chat_requests_total`
- `chat_request_duration_ms`
- `retrieval_stage_duration_ms`
- `retrieval_total_duration_ms`
- `retrieval_zero_hits_total`
- `openai_requests_total`
- `openai_request_duration_ms`
- `eval_runs_total`
- `eval_run_duration_ms`
- `eval_cases_total`

`GET /api/v1/ops/metrics` returns:

- in-process API counters and histograms
- DB-backed ingestion counts
- latest eval summary

`metrics-extension.ts` is the API-side export hook for future Prometheus or OpenTelemetry integration.

### Worker

The worker does not expose a metrics endpoint today.

It does provide a small extension hook in `app/core/metrics.py` so future instrumentation can register a sink for:

- `ingest_jobs_total`
- `ingest_job_duration_ms`

This is intentionally an extension point only, not a fake dashboard.

### Tracing

`TracingService` on the API is a no-op span surface today. It exists so OpenTelemetry can be wired later without rewriting every call site.

## Operationally Useful Events

Good first events to grep during incidents:

- `request_completed`
- `request_failed`
- `request_failed_internal`
- `health_ready`
- `health_ready_failed`
- `retrieval_completed`
- `retrieval_query_embedding_failed`
- `chat_answer_generated`
- `chat_answer_skipped_generation`
- `chat_answer_generation_failed`
- `citation_chunk_ids_rejected`
- `ingest_job_enqueued`
- `worker_job_received`
- `worker_job_completed`
- `worker_job_retryable_failure`
- `worker_job_terminal_failure`
- `ingest_completed`
- `ingest_failed`
- `ops_retry_enqueued`

## Remaining Blind Spots

- no distributed trace propagation across API and worker beyond `correlation_id` carried in job payloads
- no Prometheus scrape endpoint
- no OpenTelemetry exporter
- no queue-depth readiness gate
- no built-in dashboarding
- no per-tenant cost or latency breakdowns
- OpenAI availability is inferred from runtime failures, not tested by readiness

## Future Instrumentation Deferred

- OpenTelemetry tracing for API and worker
- Prometheus `/metrics` endpoints
- exported histogram buckets instead of in-memory samples
- queue depth metrics from BullMQ
- alerting rules and SLOs
- persistent time-series storage
