# Incident Runbooks

These runbooks are for demo, staging, and small-team operations. They are practical triage notes, not incident-management ceremony.

For logging and readiness semantics, see [observability](../architecture/observability.md).

## Queue backlog rising

Symptoms:

- many ingest jobs remain `WAITING`
- documents remain `QUEUED` or `PROCESSING` for too long
- `GET /api/v1/ops/metrics` shows rising `waitingJobs`

Likely causes:

- worker process is down
- worker consumer did not start cleanly
- Redis connectivity or capacity issue
- jobs are retry-looping and re-entering the queue
- concurrency is too low for the current batch

First checks:

- worker `GET /api/v1/health/ready`
- API `GET /api/v1/health/ready`
- `GET /api/v1/ops/metrics`
- worker logs for `worker_job_retryable_failure`, `worker_job_terminal_failure`, `ingest_failed`

Logs and endpoints to inspect:

- `GET /api/v1/ops/jobs/failed`
- worker logs filtered by `job_id`, `queue_job_id`, or `correlation_id`
- worker readiness response `checks.consumer`

Safe immediate actions:

- restore worker or Redis before retrying jobs
- retry one representative failed job first
- do not bulk-retry unknown failures

Escalation and follow-up:

- if the queue grows while readiness stays green, inspect Redis resource limits and worker concurrency
- if failures are parser- or document-specific, treat as content or parser bugs, not queue capacity

## Ingestion job repeatedly failing

Symptoms:

- document status becomes `FAILED`
- ingest job becomes `FAILED` or `DEAD_LETTER`
- the same `error_code` repeats across attempts

Likely causes:

- object storage fetch failure
- unsupported or broken source file
- parser failure
- embedding provider failure
- database write failure during persist

First checks:

- document detail for `lastErrorCode` and `lastErrorMessage`
- `GET /api/v1/ops/jobs/failed`
- worker logs for `ingest_failed`
- inspect `ingest_timings_ms` to see the last completed stage

Logs and endpoints to inspect:

- worker logs by `document_version_id` or `ingest_job_id`
- `worker_job_retryable_failure`
- `worker_job_terminal_failure`
- `ingest_failed`

Safe immediate actions:

- fix the dependency or source-file issue first
- retry only the affected job with `POST /api/v1/ops/jobs/:id/retry`
- if the object is missing, re-upload instead of retrying blindly

Escalation and follow-up:

- parser failures need a reproducible fixture
- repeated DB or vector persist failures need database-level investigation

## Document indexed but retrieval quality is poor

Symptoms:

- document reaches `INDEXED`
- chat still returns weak answers or `out_of_scope`
- eval retrieval hit or groundedness regresses

Likely causes:

- chunking split the source badly
- embeddings were disabled during indexing
- the wrong KB, document filter, or language filter is in use
- lexical overlap is weak and semantic retrieval is unavailable

First checks:

- confirm the document really has chunks
- inspect chat logs for `retrieval_completed`
- inspect `selected_count`, `top_score`, `semantic_used`, `lexical_used`
- inspect stored `retrievalMetaJson` on the assistant message

Logs and endpoints to inspect:

- `retrieval_completed`
- `chat_answer_generated`
- latest eval summary from `GET /api/v1/ops/metrics`

Safe immediate actions:

- verify embeddings were enabled when the document was indexed
- reindex after fixing content or configuration
- relax overly narrow filters

Escalation and follow-up:

- do not jump to threshold tuning before checking retrieved chunks
- if retrieval is consistently wrong, create or expand eval cases in the relevant category

## Answer returns with no citations

Symptoms:

- chat ends as `insufficient_data` after a grounded attempt
- model answer looked plausible but citation assembly produced zero citations

Likely causes:

- model returned chunk ids outside the grounding set
- model returned grounded status with empty chunk ids
- citation assembly rejected or could not map returned chunk ids

First checks:

- API logs for `citation_chunk_ids_rejected`
- API logs for `citation_assembly_failed`
- `chat_answer_generated` or `chat_answer_skipped_generation`
- stored retrieval metadata on the assistant message

Logs and endpoints to inspect:

- `stage_timings_ms.citation_assembly_ms`
- `retrieval_completed`
- OpenAI request logs around the same `correlation_id`

Safe immediate actions:

- confirm the selected grounding set was valid
- confirm retrieved chunks belonged to the expected KB
- reproduce with the same question and correlation id before changing prompt logic

Escalation and follow-up:

- persistent model omission of chunk ids is a prompting/schema issue, not a logging issue

## No retrieval hits

Symptoms:

- chat often returns `out_of_scope`
- `retrieval_completed` has `selected_count = 0`
- `retrieval_zero_hits_total` increases in the ops metrics snapshot

Likely causes:

- KB has no indexed chunks
- filters exclude all chunks
- semantic embedding generation failed and lexical retrieval also found nothing
- query normalization produced no meaningful text

First checks:

- indexed chunk count for the KB
- `retrieval_skipped_empty_query`
- `retrieval_query_embedding_failed`
- filter settings in the request

Logs and endpoints to inspect:

- `GET /api/v1/ops/metrics`
- `retrieval_completed`
- assistant message `retrievalMetaJson`

Safe immediate actions:

- verify ingestion completed
- relax filters
- reindex with embeddings enabled if semantic search is expected

Escalation and follow-up:

- if chunks exist but no candidates are found, inspect retrieval SQL and scoring inputs

## Chat latency spike

Symptoms:

- end-to-end chat latency rises materially
- users report slow grounded answers
- eval run latency rises materially

Likely causes:

- OpenAI latency increase
- retrieval pool too large
- DB persistence slowdown
- concurrent eval or ingestion load competing for resources

First checks:

- inspect `stage_timings_ms` on `chat_answer_generated`
- compare `retrieval_wall_ms`, `model_generation_ms`, and `persist_ms`
- inspect `openai_request_completed` latency
- inspect ops metric histograms

Logs and endpoints to inspect:

- `chat_answer_generated`
- `openai_request_completed`
- `GET /api/v1/ops/metrics`

Safe immediate actions:

- reduce concurrent load
- avoid increasing grounding limits during an incident
- isolate whether the spike is retrieval, model, or persistence

Escalation and follow-up:

- if latency is mostly model-side, treat it as provider or network behavior
- if latency is mostly retrieval or persistence, inspect DB and service resource saturation

## Object storage unavailable

Symptoms:

- API or worker readiness returns `503`
- upload fails
- ingest fails at fetch stage

Likely causes:

- MinIO or S3 endpoint unavailable
- bucket missing
- bad credentials
- network path issue

First checks:

- API `GET /api/v1/health/ready`
- worker `GET /api/v1/health/ready`
- failed dependency and per-check latencies in the readiness response

Logs and endpoints to inspect:

- `object_storage_bucket_check_failed`
- `object_storage_upload_failed`
- worker `ingest_failed` with early `object_fetch_ms`

Safe immediate actions:

- restore storage first
- verify bucket and credentials
- do not retry large batches until readiness is green

Escalation and follow-up:

- if readiness passes but fetch still fails, inspect object-key correctness and bucket policy

## Suspicious access leakage or scope bug

Symptoms:

- citations come from an unexpected KB or document
- a user sees content outside their scope
- retrieval or citation integrity logs show KB mismatch

Likely causes:

- authorization regression
- retrieval SQL scoping bug
- KB id mismatch between conversation and request
- testing with admin credentials masked a real access problem

First checks:

- inspect the user role and KB membership
- inspect `retrieval_kb_integrity_violation`
- inspect audit logs around `CHAT_ASK`, `DOCUMENT_UPLOAD`, and retry actions

Logs and endpoints to inspect:

- API error logs with `expected_kb_id` and invalid chunk ids
- relevant conversation and message rows
- authorization and retrieval code paths

Safe immediate actions:

- stop demo traffic if the leak is real
- preserve logs and affected identifiers
- reproduce with a non-admin account

Escalation and follow-up:

- treat as a security incident
- do not paper over the issue by loosening logging or disabling checks
