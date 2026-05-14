import { EvalScoringService } from "./eval-scoring.service";
import { EvalExecutionResult } from "./eval.types";

describe("EvalScoringService", () => {
  const service = new EvalScoringService();

  const execution = (
    overrides: Partial<EvalExecutionResult> = {},
  ): EvalExecutionResult => ({
    status: "grounded",
    answer: "Reset the worker before retrying the failed job.",
    citations: [
      {
        rank: 1,
        score: 0.8,
        chunkId: "chunk-1",
        documentId: "doc-1",
        documentTitle: "Worker Runbook",
        snippet: "Reset the worker before retrying the failed job.",
        page: 3,
        section: "Troubleshooting",
      },
    ],
    usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
    latencyMs: 200,
    topScore: 0.8,
    selectedSources: [
      {
        chunkId: "chunk-1",
        documentId: "doc-1",
        documentTitle: "Worker Runbook",
        score: 0.8,
        page: 3,
        section: "Troubleshooting",
        snippet: "Reset the worker before retrying the failed job.",
      },
    ],
    ...overrides,
  });

  it("passes a clear single-source factual case", () => {
    const result = service.scoreCase(
      {
        question: "How do I reset the worker?",
        expectedAnswer: "Reset the worker before retrying the failed job.",
        expectedSourceDocumentId: "doc-1",
        category: "single_source_factual",
      },
      execution(),
    );

    expect(result.passed).toBe(true);
    expect(result.sourceHit).toBe(true);
    expect(result.grounded).toBe(true);
    expect(result.citationIntegrity).toBe(true);
    expect(result.dimensions.answer_usefulness.passed).toBe(true);
  });

  it("passes a multi-source synthesis case only when multiple cited documents support it", () => {
    const result = service.scoreCase(
      {
        question: "How should I recover after an indexing failure?",
        expectedAnswer:
          "Reset the worker, then requeue the ingest job and verify the document returns to INDEXED.",
        expectedSourceDocumentId: "doc-1",
        category: "multi_source_synthesis",
      },
      execution({
        answer:
          "Reset the worker, then requeue the ingest job and verify the document returns to INDEXED.",
        citations: [
          {
            rank: 1,
            score: 0.8,
            chunkId: "chunk-1",
            documentId: "doc-1",
            documentTitle: "Worker Runbook",
            snippet: "Reset the worker before retrying the failed job.",
            page: 3,
            section: "Troubleshooting",
          },
          {
            rank: 2,
            score: 0.76,
            chunkId: "chunk-2",
            documentId: "doc-2",
            documentTitle: "Ingest Runbook",
            snippet: "Requeue the ingest job and confirm the document returns to INDEXED.",
            page: 5,
            section: "Recovery",
          },
        ],
        selectedSources: [
          {
            chunkId: "chunk-1",
            documentId: "doc-1",
            documentTitle: "Worker Runbook",
            score: 0.8,
            page: 3,
            section: "Troubleshooting",
            snippet: "Reset the worker before retrying the failed job.",
          },
          {
            chunkId: "chunk-2",
            documentId: "doc-2",
            documentTitle: "Ingest Runbook",
            score: 0.76,
            page: 5,
            section: "Recovery",
            snippet: "Requeue the ingest job and confirm the document returns to INDEXED.",
          },
        ],
      }),
    );

    expect(result.passed).toBe(true);
    expect(result.secondaryMetrics.distinctCitedDocuments).toBe(2);
    expect(result.failureReasons).toHaveLength(0);
  });

  it("fails when retrieval misses the expected source even if the answer text overlaps", () => {
    const result = service.scoreCase(
      {
        question: "How do I reset the worker?",
        expectedAnswer: "Reset the worker before retrying the failed job.",
        expectedSourceDocumentId: "doc-expected",
        category: "ambiguous_keyword_overlap",
      },
      execution({
        citations: [
          {
            rank: 1,
            score: 0.7,
            chunkId: "chunk-2",
            documentId: "doc-other",
            documentTitle: "Other Runbook",
            snippet: "Reset the worker before retrying the failed job.",
            page: 7,
            section: "Troubleshooting",
          },
        ],
        selectedSources: [
          {
            chunkId: "chunk-2",
            documentId: "doc-other",
            documentTitle: "Other Runbook",
            score: 0.7,
            page: 7,
            section: "Troubleshooting",
            snippet: "Reset the worker before retrying the failed job.",
          },
        ],
      }),
    );

    expect(result.passed).toBe(false);
    expect(result.failureReasons).toContain("expected_source_missing");
    expect(result.failureReasons).toContain("expected_source_not_cited");
  });

  it("passes a clean out-of-scope refusal case", () => {
    const result = service.scoreCase(
      {
        question: "What is the vacation policy?",
        category: "out_of_scope",
      },
      execution({
        status: "out_of_scope",
        answer:
          "I could not find relevant support material in the selected knowledge base for that question.",
        citations: [],
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        latencyMs: 50,
        topScore: 0,
        selectedSources: [],
      }),
    );

    expect(result.passed).toBe(true);
    expect(result.correctRefusal).toBe(true);
    expect(result.dimensions.refusal_quality.score).toBe(2);
    expect(result.dimensions.citation_integrity.score).toBe(2);
  });

  it("fails a grounded-looking answer that is missing citations", () => {
    const result = service.scoreCase(
      {
        question: "How do I reset the worker?",
        expectedAnswer: "Reset the worker before retrying the failed job.",
        expectedSourceDocumentId: "doc-1",
        category: "single_source_factual",
      },
      execution({
        citations: [],
      }),
    );

    expect(result.passed).toBe(false);
    expect(result.failureReasons).toContain("answer_not_grounded");
    expect(result.failureReasons).toContain("citation_integrity_failed");
  });
});
