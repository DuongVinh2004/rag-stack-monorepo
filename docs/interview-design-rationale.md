# Design rationale (interview notes)

Concise answers you can defend in technical interviews. All of this matches the implementation as of this repo.

## Why NestJS for the API and FastAPI for the worker?

- **NestJS** fits a long-lived HTTP API with auth, validation, modular boundaries, and OpenAPI/Swagger—common for production-style TypeScript backends.
- **FastAPI** is a lightweight fit for an **I/O-heavy worker** (parse files, call OpenAI, DB writes) with clear Python ergonomics for parsers and NLP-adjacent code.
- **Split processes** keep ingestion CPU/memory and dependency churn isolated from the API; the queue is the contract between them.

## Why PostgreSQL + pgvector?

- One relational store for users, KBs, documents, versions, chunks, and **vector search** without bolting on a second DB for v1.
- `pgvector` supports similarity search aligned with how chunks are stored (embedding per chunk, filtered by KB and access rules).

## Why Redis / BullMQ?

- Ingestion is **asynchronous**: uploads must return quickly while work continues.
- BullMQ gives retries, job metadata, and operator visibility (failed job listing, retry) without building a custom scheduler.

## Why separate documents and document versions?

- **Re-upload and reindex** create new logical versions without losing history.
- Status and errors attach per version; retrieval can target stable indexed content while a new version is processing.

## Why chunk-level embedding metadata?

- Retrieval operates on **chunks**, not whole files; semantic search needs vectors aligned to chunk boundaries.
- Storing model name and dimensions on the chunk supports **reindex** when models change and keeps queries honest.

## Why grounding and citations?

- Reduces **hallucination risk** in a support context: the model is constrained to retrieved evidence.
- **Citations** give users and auditors a path from an answer back to source documents (answer-level citations in v1).

## Why evals and observability?

- **Evals** exercise the same retrieval/chat path as production traffic, so regressions show up before manual QA only.
- **Structured logs, health checks, and stage timings** make debugging and demos credible without pretending to run a full observability vendor stack.

## What was intentionally left out of v1?

- Multi-provider LLM abstraction beyond the current OpenAI gateway shape.
- OCR, cross-encoder reranking, sentence-level citation alignment.
- Kubernetes manifests, Prometheus `/metrics` endpoints, and full OpenTelemetry (hooks and docs exist for future wiring).
- Multi-tenant billing, rate limiting per tenant, and hardened production security hardening beyond JWT + RBAC basics.

See [feature matrix](./feature-matrix.md) and [roadmap](./roadmap.md).
