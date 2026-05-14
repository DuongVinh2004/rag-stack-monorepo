# Portfolio summary (copy-friendly)

Truthful copy derived from the codebase. Adjust wording to match what *you* personally implemented if you fork or extend.

---

## Short portfolio description (~2 sentences)

Backend for a knowledge-base support copilot: NestJS API handles auth, RBAC, uploads, hybrid retrieval, and grounded chat with citations; a Python worker ingests documents asynchronously via BullMQ/Redis into PostgreSQL + pgvector. Includes eval runs, operator tooling, structured observability, and Docker-based local demo—scoped as a strong engineering sample, not a full SaaS product.

---

## GitHub project description (~350 characters)

Monorepo: NestJS API + FastAPI worker, PostgreSQL/pgvector, Redis/BullMQ, S3-compatible storage, OpenAI for embeddings & grounded chat. Auth, KB ingestion, hybrid RAG, citations, evals, ops & health endpoints. Demo compose + tests. Portfolio scope; not production-hardened.

---

## CV bullet options (pick 3–5)

1. Designed a **multi-service RAG backend** (NestJS + FastAPI) with JWT auth, KB-scoped RBAC, and async document ingestion via **BullMQ/Redis** into **PostgreSQL + pgvector**.
2. Implemented **hybrid retrieval** (semantic + lexical with graceful embedding failure), **grounded chat** with **citation assembly**, and persisted conversation metadata for auditability.
3. Built an **operator** surface: failed ingest job retry, health/readiness against real dependencies, structured **logs with stage timings**, and in-process metrics with an **export hook** for future Prometheus/OTel.
4. Added **regression-style eval runs** that execute the same retrieval/chat pipeline as live traffic, with stored summaries for comparison.
5. Delivered **Docker Compose** demo stack, seed data, API e2e tests, and worker pytest coverage to keep the project **reviewable and defensible** in interviews.

---

## 30-second architecture explanation (interview)

“We split the API from the ingestion worker so uploads return fast while heavy parsing and embedding run out of band. Redis queues jobs; PostgreSQL holds documents, versions, and chunk vectors for pgvector search. The chat path retrieves evidence first, then calls the LLM with JSON-grounded output so we can attach citations. Observability is structured logging and health checks—not a full APM—because the goal was credible engineering without pretending we run production SRE.”

---

## Tradeoffs (if pressed)

| Topic | Honest position |
|-------|------------------|
| One DB + pgvector | Simpler ops than dual vector DB; good enough for demo and moderate scale. |
| BullMQ vs Kafka | Kafka is overkill for single-tenant demo throughput; BullMQ matches Nest and gives retries. |
| Answer-level citations | Sentence-level alignment costs more complexity; v1 prioritizes traceability over perfect spans. |
| OpenAI in code | Tight integration first; swapping providers is a planned refactor, not shipped abstraction. |

---

## Completeness classification (ruthless)

| Bucket | Items |
|--------|--------|
| **Complete** | Auth, KB CRUD + membership, upload + ingest pipeline, hybrid retrieval, grounded chat + citations, conversations, evals, ops retry/metrics snapshot, health endpoints, structured logging, CI + unit/e2e + worker tests |
| **Partial** | Metrics (in-process + ops snapshot + optional export hook; no `/metrics`), tracing (stub only) |
| **Scaffold** | `registerMetricsExportHook`, `TracingService` span holder |
| **Deferred** | Multi-provider LLM, OCR, cross-encoder rerank, K8s/HA, Prometheus scrape, full OTel |

---

## Strongest parts (for interviews)

- End-to-end **ingest → index → retrieve → cite** path is real and test-backed.
- **Access control** is applied consistently on KB/document/conversation paths (not bolted on only at the controller).
- **Failure handling** is visible: ingest retries, safe error responses with correlation ids, readiness failures when dependencies are down.

---

## Weakest parts (be upfront)

- No horizontal scaling story in-repo; compose is for **local/demo**.
- **Metrics** are not exported to Prometheus by default.
- **Evals** are synchronous API-driven runs—fine for smoke, not for massive batch evaluation.

---

## Likely interview questions → grounded answers

| Question | Answer anchor in repo |
|----------|------------------------|
| How do you prevent cross-KB leakage? | Authorization services + retrieval queries scoped by membership; integrity check in chat service |
| What if OpenAI is down? | Chat returns 503 when grounded chat unavailable; embeddings fall back to lexical retrieval |
| How do you test RAG? | E2e chat tests with fake Prisma/OpenAI; evals run real pipeline with controlled data |
| Why FastAPI? | Worker is parse/embed/IO heavy; Python ecosystem for parsers |

---

## Recommended next priorities (if continuing)

1. Wire **one** metrics exporter behind `registerMetricsExportHook` and document it.
2. Add a **short ADR** folder for one or two decisions (queue choice, pgvector).
3. Keep README claims **tight**—credibility beats feature lists.
