# Citation Design

## V1 granularity

V1 uses **answer-level citations**.

Why:

- The current model interface returns `used_chunk_ids`, not sentence-to-source alignments.
- The backend can honestly say "this answer is grounded in these retrieved chunks" without pretending to know which exact sentence came from which exact span.
- Answer-level citations are practical to persist, audit, and evaluate today.

V1 does **not** claim sentence-level precision.

## Citation source policy

Final citations are selected from **final grounding chunks only**.

More precisely:

1. Retrieval produces the final authorized grounding set.
2. The model returns `used_chunk_ids` as answer-level evidence hints.
3. The citation layer intersects `used_chunk_ids` with the grounding set.
4. Only that intersection is eligible for user-visible citations.

This means:

- chunks outside the authorized grounding set are ignored
- chunks outside the authorized KB scope are ignored
- low-value retrieved chunks that did not survive grounding do not appear in final citations

## Answer-to-evidence mapping heuristic

V1 uses a deterministic heuristic, not semantic entailment alignment.

For each valid cited chunk:

- start from the chunk's grounded retrieval score
- add a small answer-text overlap signal
- add a small query overlap signal
- rank deterministically

This is acceptable for v1 because:

- the model already had to choose from the grounded chunk set
- answer-level citations only need to identify the supporting chunks, not exact sentence spans
- retrieval score remains the dominant evidence signal

What would be needed later for finer precision:

- sentence segmentation of the answer
- sentence-to-span alignment inside chunks
- either lexical span matching plus better heuristics, or a dedicated entailment/alignment model

## Selection rules

- Max citations returned: `CHAT_CITATION_LIMIT` or default `3`
- Candidate set: grounded chunks referenced by valid `used_chunk_ids`
- Ordering:
  1. citation support score descending
  2. retrieval score descending
  3. grounding rank ascending
  4. page number ascending when both exist
  5. chunk id ascending

### Same-document handling

Keep multiple citations from the same document when:

- they come from different sections
- they come from different pages
- they have materially different text

Suppress a lower-ranked same-document citation when:

- it is the same chunk
- it is a near-duplicate adjacent chunk from the same document version
- it repeats the same section with high overlap and does not add distinct support

## Snippet extraction

Snippets come from real chunk text only.

V1 snippet strategy:

- normalize whitespace
- score sentence-like or short paragraph-like windows against answer text and query text
- choose one best contiguous window
- if the window is too long, trim around the best anchor span
- apply ellipsis only when the excerpt is trimmed at the start or end

Rules:

- max snippet length: `MAX_CITATION_SNIPPET_LENGTH`
- snippet is a single contiguous excerpt
- if no good anchor exists, fall back to a clean prefix excerpt
- do not stitch together non-contiguous spans

This is a heuristic excerpt strategy, not exact span extraction.

## Failure modes

- Model returned `grounded` but no valid citation candidates:
  - downgrade to `insufficient_data`
- Retrieved chunk exists but snippet extraction fails:
  - drop that chunk from final citations
  - if no valid citations remain, downgrade to `insufficient_data`
- Missing page or section metadata:
  - return `null` for that field
- Persistence fails after answer generation:
  - fail the request rather than returning an unpersisted answer/citation state
- Retrieval path returns cross-KB chunks due to a bug:
  - drop them before prompt/citation use and fail safely if integrity is broken

## Persistence model

Each citation row stores:

- `messageId`
- `chunkId`
- `documentId`
- `documentTitle`
- `rank`
- `score`
- `snippet`
- `pageNumber`
- `sectionTitle`
- `createdAt`

Why snapshots matter:

- citation views should stay stable even if a document title changes later
- denormalized `documentId` helps audit and downstream lookups

Deletes/archival:

- citations are created in the same transaction as the assistant message
- citations cascade with their assistant message
- citations also cascade with deleted chunks/documents in v1, so this is not a write-once audit archive

## Known limits

- answer-level only
- no sentence-level alignment
- no model-verified entailment checks
- same-document redundancy suppression is heuristic
- snippet selection is heuristic but explicit

## Tuning guidance

- Keep citations constrained to the grounded chunk set.
- Keep retrieval score dominant in citation ranking.
- Do not fall back from invalid `used_chunk_ids` to arbitrary grounding chunks for grounded answers.
- Do not increase the max citation count casually; more citations often reduce trust.
