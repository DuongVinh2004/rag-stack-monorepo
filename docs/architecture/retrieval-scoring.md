# Retrieval Scoring Design

## Why this exists

- Retrieval quality should come from an explicit scoring pipeline, not from implicit behavior spread across SQL ordering, merge code, and dedup side effects.
- The chat and eval pipeline need deterministic ranking, bounded candidate pools, and debug metadata that another engineer can inspect later.

## Current weaknesses

- Semantic, lexical, metadata, and recency signals are mixed together inside one merge function.
- Lexical normalization is partly based on raw `ts_rank_cd` and partly on token coverage, but the contract is not documented.
- Recency always contributes, even when the user did not ask a time-sensitive question.
- Dedup removes candidates after ranking without preserving rank provenance or suppression reason.
- Candidate generation uses one limit for everything, so semantic fetch size, lexical fetch size, and rerank pool size are not independently visible.

## Revised pipeline

1. Normalize and parse the query deterministically.
2. Fetch semantic candidates inside KB scope.
3. Fetch lexical candidates inside KB scope.
4. Merge duplicate chunk ids into one candidate while preserving source provenance.
5. Compute normalized scores for each signal.
6. Combine scores with fixed weights into one final score.
7. Sort with explicit tie breakers.
8. Apply bounded dedup / redundancy suppression.
9. Select the grounding top-k.
10. Store or log ranking debug metadata for evaluation contexts.

## Query preprocessing

- Trim whitespace.
- Normalize Unicode with `NFKC`.
- Collapse repeated internal whitespace.
- Lowercase for matching logic.
- Preserve paired double-quoted phrases for lexical search and phrase bonuses.
- Derive lexical tokens deterministically from the normalized query.
- Detect a narrow freshness intent flag from explicit time-sensitive terms such as `latest`, `recent`, `current`, `today`, or `updated`.

This layer does not rewrite the query or infer hidden intent.

## Candidate generation

- Semantic fetch:
  - source: pgvector cosine distance on `DocumentChunk.embedding`
  - default top-N: `CHAT_RETRIEVAL_SEMANTIC_CANDIDATE_LIMIT` or fallback base candidate limit
- Lexical fetch:
  - source: PostgreSQL full-text search on `searchText`
  - query function: `websearch_to_tsquery('simple', ...)` so quoted phrases are preserved
  - default top-N: `CHAT_RETRIEVAL_LEXICAL_CANDIDATE_LIMIT` or fallback base candidate limit
- Rerank pool:
  - source: merged union of semantic and lexical candidates
  - capped to `CHAT_RETRIEVAL_RERANK_LIMIT`
- Grounding set:
  - top-K after rerank and dedup
  - capped by `CHAT_RETRIEVAL_GROUNDING_LIMIT`

All candidate fetches enforce KB access scope and metadata filters in SQL before ranking.

## Score definitions

### Semantic score

- Meaning: normalized vector relevance from pgvector cosine distance.
- Raw source: `cosine_distance = embedding <=> query_vector`
- Expected raw range: `[0, 2]`
- Normalization: `semantic_score = clamp(1 - cosine_distance / 2, 0, 1)`
- Missing value handling: `0`

This keeps the score monotonic with cosine similarity while mapping it to a stable `[0, 1]` range.

### Lexical score

- Meaning: exact wording support from full-text rank, token overlap, and quoted phrase hits.
- Raw sources:
  - PostgreSQL `ts_rank_cd`
  - query token coverage against `searchText`
  - quoted phrase coverage against `searchText`
- Expected normalized range: `[0, 1]`
- Normalization:
  - `fts_score = raw_ts_rank / (raw_ts_rank + 1)` when present, else `0`
  - `token_coverage = matched_query_tokens / total_query_tokens`
  - `phrase_coverage = matched_phrases / total_phrases`
  - `lexical_score = clamp(0.55 * fts_score + 0.25 * token_coverage + 0.20 * phrase_coverage, 0, 1)`
- Missing value handling: absent components contribute `0`

This makes exact phrases matter without letting a small lexical hit dominate a clearly better semantic match.

### Metadata match score

- Meaning: useful metadata alignment that is still auditable.
- Supported signals:
  - exact document filter match
  - exact language filter match
  - overlap between query terms and metadata tags / keywords when present in `metadataJson`
- Expected normalized range: `[0, 1]`
- Normalization: average of active metadata sub-signals
- Missing value handling:
  - no active filters or metadata terms => `0`
  - missing candidate metadata => `0` for metadata-derived sub-signals

Metadata filters remain hard constraints in SQL. This score is a secondary ranking signal, not an authorization mechanism.

### Recency score

- Meaning: mild freshness bias only when the query explicitly asks for recent/current information.
- Raw source: chunk `indexedAt`
- Expected normalized range: `[0, 1]`
- Normalization:
  - if freshness intent is false: `0`
  - else `recency_score = 1 / (1 + age_days / 180)`
- Missing value handling: `0`

Recency is intentionally weak and query-gated so it cannot dominate correctness.

### Structural score

- Meaning: document structure alignment that is common in support corpora.
- Supported signals:
  - query coverage in `sectionTitle`
  - query coverage in `sourceTitle` / document title
  - FAQ-like heading bonus when the chunk appears to be a question/answer section
- Expected normalized range: `[0, 1]`
- Normalization:
  - `structural_score = clamp(0.55 * section_coverage + 0.30 * title_coverage + 0.15 * faq_bonus, 0, 1)`
- Missing value handling: `0`

This is optional but justified because support content often stores the strongest intent match in headings rather than body text.

## Final score

`final_score =`
`0.58 * semantic_score +`
`0.22 * lexical_score +`
`0.10 * metadata_match_score +`
`0.03 * recency_score +`
`0.07 * structural_score`

### Weight rationale

- `semantic = 0.58`
  - primary signal for paraphrase handling and broad relevance
- `lexical = 0.22`
  - important for exact product names, error strings, and quoted phrases
- `metadata = 0.10`
  - rewards explicit document/language/tag alignment without bypassing scope rules
- `recency = 0.03`
  - intentionally too small to overrule better evidence
- `structural = 0.07`
  - useful for runbooks, headings, FAQ sections, and titled support docs

Weights sum to `1.0` and remain simple enough to audit.

## Missing score handling

- Every score is normalized independently to `[0, 1]`.
- Missing or non-finite values become `0`.
- Missing signals do not delete a candidate; they only reduce its contribution.
- A lexical-only or semantic-only hit can still rank if the available evidence is strong enough.

## Deterministic ranking

Candidates sort by:

1. `final_score` descending
2. `semantic_score` descending
3. `lexical_score` descending
4. `metadata_match_score` descending
5. `structural_score` descending
6. `indexedAt` descending
7. `chunkId` ascending

This guarantees stable ordering even when scores tie.

## Deduplication and redundancy control

### Exact duplicate handling

- Duplicate `chunkId` values are merged before reranking.
- Source provenance is preserved:
  - whether the chunk came from semantic retrieval, lexical retrieval, or both
  - source-specific ranks and raw scores

### Near-duplicate handling

- After reranking, a lower-ranked candidate is suppressed when all of these are true:
  - same `documentVersionId`
  - adjacent or near-adjacent `chunkNo`
  - high text overlap by Jaccard similarity on normalized `searchText`
  - no unique structural or phrase evidence compared with the already-kept neighbor

### When adjacent chunks should both remain

- different section titles with meaningful section/title coverage
- different quoted phrase matches
- overlap is below the near-duplicate threshold
- one chunk adds materially different content even if the document and section are the same

This keeps useful context while reducing repeated runbook boilerplate.

## Debug metadata contract

For each reranked candidate, evaluation/debug contexts should be able to inspect:

- `chunk_id`
- `document_id`
- `semantic_score`
- `lexical_score`
- `metadata_match_score`
- `recency_score`
- `structural_score`
- `final_score`
- `selection_reason`
- `rank_before_dedup`
- `rank_after_dedup`
- source provenance
- dedup suppression reason when removed

The public chat response should not expose this full payload to normal end users.

## Performance guardrails

- No unbounded candidate pools.
- Semantic and lexical fetches remain set-based SQL queries.
- Reranking is in-memory over a bounded merged set only.
- Duplicate chunk ids are merged in-memory, not re-fetched.
- Stage timings should be measured separately for:
  - embedding
  - semantic fetch
  - lexical fetch
  - merge/rerank
  - dedup

## Tuning rules

- Do not change the weight order casually. Semantic must stay dominant.
- Do not increase recency weight unless you also tighten freshness-intent detection.
- Do not let lexical phrase bonuses become large enough to outrank clearly better semantic hits by default.
- Keep normalization bounded to `[0, 1]`.
- If metadata tags become schema-specific later, extend metadata scoring explicitly instead of adding opaque heuristics.
