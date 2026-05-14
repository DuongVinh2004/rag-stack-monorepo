# Roadmap / next steps

Ordered by typical value for a portfolio or small production hardening pass. None of this is promised on a timeline—pick what matches your goals.

## Near-term (credibility + ops)

1. **Prometheus or OpenTelemetry** — Wire `registerMetricsExportHook` (see `metrics-extension.ts`) to a real exporter; add `/metrics` or OTLP only if you want to operate it.
2. **Queue depth metric** — Expose BullMQ waiting/active counts next to existing ops DB counts.
3. **Load testing note** — Document expected limits (concurrent chat, worker concurrency) from a single-machine demo.

## Medium-term (product + quality)

4. **Provider abstraction** — Narrow interface for chat + embeddings with OpenAI as first implementation.
5. **Reranking** — Optional cross-encoder or lightweight reranker behind a feature flag.
6. **Eval runner** — Optional background worker for long eval sets (today runs are synchronous through the API path).

## Explicit non-goals for this repo

- Full SaaS billing, multi-region HA, or SOC2-style compliance narratives unless you add real controls and evidence.
- Replacing PostgreSQL with a separate vector-only database without a concrete migration story.

Update this file when you ship or descope items.
