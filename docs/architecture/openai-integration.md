# OpenAI Integration

## Scope

This backend uses OpenAI in two bounded paths only:

- API:
  - query embeddings for semantic retrieval
  - grounded answer generation for chat and eval execution
- Worker:
  - chunk embeddings during ingestion and reindex

Prompt assembly, retrieval scoring, citation mapping, and persistence stay outside the provider wrapper. The OpenAI layer is responsible only for provider invocation, typed result mapping, feature gating, retries/timeouts, safe logging, and error classification.

## Configuration

### Mandatory

- `OPENAI_API_KEY`
  - required only for features that actually call OpenAI

### Optional API settings

- `OPENAI_GROUNDED_CHAT_ENABLED`
  - default `true`
  - disables chat/eval generation without removing ingestion
- `OPENAI_EMBEDDINGS_ENABLED`
  - default `true`
  - disables semantic embedding generation and query embedding generation
- `OPENAI_CHAT_MODEL`
  - default `gpt-5`
- `OPENAI_EMBEDDING_MODEL`
  - default `text-embedding-3-small`
- `OPENAI_REQUEST_TIMEOUT_MS`
  - default `30000`
- `OPENAI_MAX_RETRIES`
  - default `2`
- `OPENAI_RETRY_BASE_DELAY_MS`
  - default `250`
  - base backoff for explicit retry scheduling on transient provider failures
- `OPENAI_GROUNDED_CHAT_MAX_CHUNKS`
  - default `6`
  - caps how many retrieved chunks are passed into grounded generation
- `OPENAI_TEMPERATURE`
  - default `0.1`

### Optional worker settings

- `OPENAI_EMBEDDINGS_ENABLED`
  - default `true`
- `OPENAI_REQUEST_TIMEOUT_MS`
  - default `30000`
- `OPENAI_MAX_RETRIES`
  - default `2`
- `OPENAI_RETRY_BASE_DELAY_MS`
  - default `250`
- `OPENAI_EMBEDDING_BATCH_SIZE`
  - default `32`
  - legacy `EMBEDDING_BATCH_SIZE` is still accepted
- `OPENAI_EMBEDDING_BATCH_TOKEN_LIMIT`
  - default `12000`
  - legacy `EMBEDDING_BATCH_TOKEN_LIMIT` is still accepted

## Fallback behavior

- Missing `OPENAI_API_KEY`:
  - ingestion still runs
  - worker marks vectorization as `DISABLED`
  - retrieval falls back to lexical-only
  - chat falls back to the local extractive grounded-answer path
  - eval answer generation still returns `503`
- `OPENAI_EMBEDDINGS_ENABLED=false`:
  - worker skips chunk embeddings
  - query-time retrieval skips semantic search
  - grounded chat may still run on lexical retrieval results
- `OPENAI_GROUNDED_CHAT_ENABLED=false`:
  - retrieval still runs
  - chat falls back to the local extractive grounded-answer path
  - eval answer generation does not call the model and returns `503`

## API architecture

- `OpenAiConfigService`
  - centralizes feature flags, model names, timeout, retry policy, max grounding chunks, and temperature
- `OpenAiClientService`
  - the only API component that invokes the OpenAI SDK
  - owns explicit retries with backoff and safe retry logging
- `OpenAiEmbeddingService`
  - creates typed query embedding results
  - converts provider failures into `success | failed | disabled` retrieval inputs
- `OpenAiGroundedChatService`
  - sends grounded prompts to the Responses API
  - validates and normalizes structured output before business services consume it
- `OpenAiUsageMapperService`
  - normalizes provider usage into stable internal token accounting fields
- `OpenAiObservabilityService`
  - records request metrics and safe structured logs without prompts or retrieved content
- `OpenAiGatewayService`
  - thin facade used by retrieval, chat, and eval flows
- `PromptBuilderService`
  - assembles prompts and grounding context
  - does not call the SDK
- `ChatService` and `EvalsService`
  - own business decisions such as whether to skip generation, downgrade to `insufficient_data`, and persist usage/citations

## Worker embedding architecture

- `OpenAiEmbeddingClient`
  - the only worker component that invokes the OpenAI SDK
  - owns explicit retries, latency measurement, safe retry logging, and provider error mapping
- `Embedder`
  - batches by chunk count and estimated token budget
  - stores `embedding_model` and `embedding_dim` on each chunk
  - applies validated embedding results to chunks and logs batch size, attempts, latency, and token usage without logging chunk text

Batching is deterministic:

- preserve chunk order
- start a new batch when either count or token limit is exceeded
- no in-memory regrouping by content or metadata

## Embedding compatibility assumptions

- Query embeddings are generated with the configured `OPENAI_EMBEDDING_MODEL`.
- Semantic retrieval filters stored chunks by both `dc."embeddingModel" = $embeddingModel` and `dc."embeddingDim" = $embeddingDim`.
- This prevents mixing vectors created by different embedding models or incompatible dimensions during reindex/model-swap windows.
- If a KB has no stored vectors for the configured model, semantic retrieval contributes zero candidates and lexical retrieval still runs.

## Grounded chat contract

- The model only receives retrieved chunks selected by retrieval and bounded by `OPENAI_GROUNDED_CHAT_MAX_CHUNKS`.
- The system prompt explicitly states that retrieved chunks are untrusted evidence, not instructions.
- Empty or malformed model output is treated as a failure, not as a partial success.
- Grounded answers are downgraded to `insufficient_data` when citation assembly cannot validate support.

## Error codes

- `OPENAI_AUTH_ERROR`
- `OPENAI_RATE_LIMIT`
- `OPENAI_TIMEOUT`
- `OPENAI_TRANSIENT_ERROR`
- `OPENAI_INVALID_REQUEST`
- `OPENAI_RESPONSE_EMPTY`
- `OPENAI_EMBEDDING_FAILED`
- `OPENAI_CHAT_FAILED`

Policy:

- retry only through explicit application-owned retries on transient classes
- do not retry invalid requests
- return lexical-only retrieval when query embeddings fail
- return `503` to callers when grounded chat fails after the provider-backed path is selected

## Observability and safe logging

Logged fields:

- request type
- model
- latency
- retry attempt count
- success or failure outcome
- safe error code
- correlation id where available
- KB id where available
- embedding batch size
- token usage counts when the provider returns them

Not logged by default:

- raw prompts
- full retrieved chunk content
- API keys
- document bodies

The structured loggers redact obvious secret-bearing fields automatically, but the OpenAI integration avoids including prompt/content fields in the first place.

## Usage accounting

API usage is normalized into:

- `inputTokens`
- `outputTokens`
- `totalTokens`
- `cachedInputTokens`
- `reasoningTokens`

Chat responses persist the standard `input/output/total` fields. Additional cached/reasoning counts are currently used for observability and can be added to persistence later without changing provider invocation logic.

## Known limitations

- There is no second provider implementation yet; the abstraction is OpenAI-shaped, not fully vendor-neutral.
- Query embedding failures do not currently surface a dedicated API response field; they are visible through retrieval metadata and server logs.
- Batch sizing is count-plus-token based, not provider-tokenizer exact, so very unusual inputs may still need tighter limits per model family.
- The local extractive fallback is intentionally narrow and demo-focused; it is not a replacement for a provider-backed reasoning model.

## Safe future changes

- Swap the provider behind `OpenAiGatewayService` and the worker `Embedder`, not inside business services.
- Keep prompt construction outside the SDK wrapper.
- Keep retrieval-context caps explicit and configuration-driven.
- Do not add raw prompt logging in production paths.
- If another provider is added later, introduce a provider-neutral interface at the gateway/embedder boundary instead of scattering conditional logic into chat, retrieval, or eval services.
