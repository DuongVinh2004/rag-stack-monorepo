# Feature matrix

Honest status for reviewers. “Complete” means implemented and covered by automated tests at the level described in the README/CI—not that every edge case is solved.

| Capability | Status | Notes |
|------------|--------|--------|
| JWT auth + refresh | **Complete** | Role claims on user |
| RBAC (system roles + KB roles) | **Complete** | See `access-control.md` |
| Knowledge bases + membership | **Complete** | |
| Document upload to S3-compatible storage | **Complete** | Size limits enforced |
| Async ingestion (BullMQ + worker) | **Complete** | PDF/DOCX/TXT path in worker |
| Chunking + optional embeddings | **Complete** | Embeddings can be disabled |
| Hybrid retrieval (semantic + lexical) | **Complete** | Semantic degrades if embedding fails |
| Grounded chat + citation assembly | **Complete** | OpenAI-backed when configured; local extractive fallback keeps the demo chat path runnable without it |
| Conversations + message persistence | **Complete** | |
| Eval sets / runs (admin/operator) | **Complete** | Sync runs through real pipeline; answer generation still requires OpenAI |
| Ops: failed jobs, retry, metrics snapshot | **Complete** | Admin/operator |
| Health live/ready (API + worker) | **Complete** | DB, Redis, object storage |
| Structured logging + stage timings | **Complete** | See `observability.md` |
| In-process metrics + export hook | **Partial** | Snapshot via `/ops/metrics`; optional `registerMetricsExportHook`; no Prometheus scrape |
| Distributed tracing | **Scaffold** | `TracingService` placeholder; not OTel |
| Multi-LLM provider plug-in | **Deferred** | OpenAI-focused gateway |
| OCR / scanned PDFs | **Deferred** | |
| Cross-encoder rerank | **Deferred** | In-process hybrid scorer only |
| Production K8s / HA deployment | **Deferred** | Docker compose for local/demo |
