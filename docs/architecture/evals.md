# Eval Design

## Goal

The eval system is built for product regression tracking, not benchmark theater.

It answers one practical question:

- is the grounded support backend getting better or worse at retrieving the right evidence, answering from that evidence, and refusing cleanly when it should not answer?

The runner uses the real KB-scoped retrieval and grounded chat pipeline. It is intentionally small-set and operator-oriented.

## Scope and Access

- eval access is restricted to `SUPER_ADMIN` and `OPERATOR`
- runs are synchronous and intended for smoke/regression sets, not large distributed evaluation farms
- evals are stored as `EvalSet`, `EvalCase`, `EvalRun`, and `EvalItem`

## Recommended Case Taxonomy

Recommended `EvalCase.category` values:

- `single_source_factual`
  - one document should carry the answer
  - judged primarily on source hit, groundedness, citation integrity, and usefulness
- `multi_source_synthesis`
  - answer should combine evidence from multiple documents
  - same grounded checks as above, plus at least 2 distinct cited documents
- `version_recency_sensitive`
  - answer must stay anchored to the expected current source, not just lexical overlap
  - expected source citation is treated as a hard gate
- `ambiguous_keyword_overlap`
  - wrong documents may share the same surface terms
  - explicit source hit and source citation matter more than answer word overlap
- `out_of_scope`
  - the system should refuse with `status = out_of_scope`
  - no citations allowed
- `insufficient_data`
  - the system should refuse with `status = insufficient_data`
  - no citations allowed
- `refusal`
  - either refusal mode is acceptable
  - no citations allowed
- `access_sensitive`
  - stored for future coverage, but current runner cannot truly validate this end to end because eval execution runs with operator-scoped retrieval
  - treated as human-review-oriented in v1
- `general`
  - default grounded-answer case when no stronger taxonomy applies

## Rubric

Rubric version: `practical_v1`

### Dimensions

| Dimension | Range | Primary purpose | Evaluation class |
| --- | --- | --- | --- |
| `retrieval_source_hit` | `0-1` | Did retrieval include the expected source anchor? | Automated |
| `evidence_relevance` | `0-2` | Does retrieved/cited evidence look aligned with the expected target? | Heuristic |
| `answer_groundedness` | `0-2` | Did the system actually return a grounded answer backed by citations? | Heuristic with structural checks |
| `answer_usefulness` | `0-2` | Is the answer basically correct/useful against the expected answer or hint? | Heuristic |
| `refusal_quality` | `0-2` | Did the system refuse in the right mode, briefly, with no grounded-looking answer? | Automated + heuristic |
| `citation_integrity` | `0-2` | Are citations present when needed, absent when refusing, and traceable to retrieved chunks? | Automated |
| `latency_ms` | raw metric | Performance tracking only | Automated |
| `usage` | raw metric | Token tracking only | Automated |

### Why These Dimensions

- `retrieval_source_hit` keeps the eval tied to evidence selection instead of answer-only grading
- `evidence_relevance` catches cases where the right source is present but the evidence set still looks weak or incomplete
- `answer_groundedness` penalizes grounded-looking answers that are not actually citation-backed
- `answer_usefulness` gives a lightweight correctness signal without pretending to solve nuanced answer quality
- `refusal_quality` makes refusal a first-class capability instead of treating it as failure by default
- `citation_integrity` protects against fake-looking groundedness

### Automated vs Heuristic vs Human Review

Automated in v1:

- expected source document present in retrieved top-k
- citations present when answer is grounded
- citations absent on refusal cases
- citations map back to retrieved chunk ids
- latency and usage capture

Heuristic in v1:

- evidence relevance via answer/hint term coverage
- answer usefulness/basic correctness via lexical overlap
- refusal wording quality
- groundedness strength beyond bare citation presence

Still human-review-oriented:

- nuanced factual correctness
- completeness
- sentence-level citation precision
- subtle ranking quality beyond “did we retrieve the anchor source?”
- access-sensitive cases

When no `expectedAnswer` or `expectedSourceHint` is configured, the system explicitly marks the case as requiring human review and caps some heuristic scores accordingly.

## Pass/Fail Rules

### Grounded-answer cases

Weighted overall score:

`0.25 * retrieval_source_hit`

`+ 0.15 * evidence_relevance_normalized`

`+ 0.25 * answer_groundedness_normalized`

`+ 0.25 * answer_usefulness_normalized`

`+ 0.10 * citation_integrity_normalized`

Normalized score threshold:

- `overall_score >= 0.70`

Hard gates:

- `retrieval_source_hit` must pass
- `answer_groundedness` must be full-pass
- `citation_integrity` must be full-pass
- `answer_usefulness` must at least partially pass
- `evidence_relevance` must at least partially pass

Category-specific gates:

- `multi_source_synthesis`
  - at least 2 distinct cited documents
- `version_recency_sensitive`
  - expected source must be cited
- `ambiguous_keyword_overlap`
  - expected source retrieval and citation matter more than lexical overlap

### Refusal cases

Weighted overall score:

`0.70 * refusal_quality_normalized + 0.30 * citation_integrity_normalized`

Hard gates:

- `refusal_quality = 2`
- `citation_integrity = 2`

In practice this means:

- correct refusal status for the category
- concise refusal-shaped wording
- zero citations

## Scoring Examples

### Example: clear single-source pass

- expected document retrieved and cited
- answer overlaps expected answer strongly
- grounded status with valid citations
- result: pass

### Example: false retrieval failure

- answer text looks plausible
- wrong document retrieved and cited
- expected source missing
- result: fail on `retrieval_source_hit`, likely `evidence_relevance`, and often `expected_source_not_cited`

### Example: citation-missing failure

- model says `grounded`
- answer text may even look correct
- no citations survive assembly
- result: fail on `answer_groundedness` and `citation_integrity`

### Example: correct refusal

- category expects `out_of_scope`
- system returns `status = out_of_scope`
- no citations
- short refusal wording
- result: pass

## Run Storage and Human Review Readiness

Each `EvalItem` stores enough detail for later manual inspection:

- actual answer text
- retrieved source metadata
- retrieved source snippets
- citations
- usage
- retrieval debug
- citation debug
- per-dimension scorecard
- failure reasons
- scoring notes

Each `EvalRun.summaryJson` stores:

- pass rate
- per-dimension rates with denominators
- latency and usage aggregates
- failure reason counts
- category breakdown
- comparison to the previous completed run

## Regression Comparison

Each completed run compares itself to the previous completed run for the same eval set.

Reported deltas:

- `passRateDelta`
- `retrievalHitRateDelta`
- `groundednessRateDelta`
- `refusalCorrectnessRateDelta`
- `citationIntegrityRateDelta`
- `averageLatencyDeltaMs`
- `averageScoreDelta`
- `regressionCountDelta`

Notable regressions by case are flagged when any of these happen:

- previous run passed and current run fails
- score drops by `0.20` or more
- a critical dimension flips from pass to fail:
  - `retrieval_source_hit`
  - `answer_groundedness`
  - `refusal_quality`
  - `citation_integrity`

### Meaningful Change Thresholds

The comparison only marks a metric as materially changed when it crosses a threshold:

- rate metrics:
  - `max(0.05, 1 / max(case_count_current, case_count_previous))`
  - this avoids pretending that tiny numeric noise matters, while still treating a one-case regression in a small set as meaningful
- latency:
  - `max(250ms, 20% of previous average latency)`

## Honest Limitations

False positives likely in v1:

- answers that share keywords with the expected answer but are still incomplete
- multi-source answers that mention the right terms but miss nuance across documents
- refusal wording that looks acceptable by regex but is still unhelpful to a human

False negatives likely in v1:

- correct paraphrases with low lexical overlap
- good answers on lightly specified cases without expected answers or hints
- version-sensitive answers that are right but phrase dates/versions differently than expected text

Other limitations:

- no pairwise LLM judge
- no sentence-level citation grading
- no dedicated review UI yet
- no end-to-end access-sensitive evaluation in the current runner
- no ranking metric like MRR/NDCG because the v1 product goal is simpler: did we retrieve the anchor evidence and answer from it?

## Deferred Future Improvements

Good future additions, intentionally deferred from v1:

- richer case expectations beyond one source anchor and one answer target
- exact recency/date-aware checks
- sentence-level citation attribution checks
- calibrated refusal/helpfulness judge prompts
- access-sensitive eval mode with non-operator retrieval execution
- asynchronous/background run execution for larger sets
