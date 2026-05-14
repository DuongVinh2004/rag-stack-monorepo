import {
  buildRunSummary,
  buildSummaryOnlyComparison,
  shouldFlagRegression,
} from "./eval-reporting.utils";
import { EvalRunItemSnapshot, EvalRubricDimensionName } from "./eval.types";

describe("eval-reporting.utils", () => {
  const dimension = (
    name: EvalRubricDimensionName,
    options: { passed: boolean | null; applicable?: boolean; score?: number | null },
  ) => {
    const kind =
      name === "retrieval_source_hit" || name === "citation_integrity"
        ? ("automated" as const)
        : ("heuristic" as const);

    return {
      name,
      kind,
      applicable: options.applicable ?? true,
      score:
        options.score ??
        (options.passed === null
          ? null
          : name === "retrieval_source_hit"
            ? options.passed
              ? 1
              : 0
            : options.passed
              ? 2
              : 0),
      maxScore: name === "retrieval_source_hit" ? 1 : 2,
      passed: options.passed,
      notes: "",
    };
  };

  const item = (overrides: Partial<EvalRunItemSnapshot> = {}): EvalRunItemSnapshot => ({
    evalCaseId: "case-1",
    question: "How do I reset the worker?",
    category: "single_source_factual",
    passed: true,
    score: 1,
    regressionFlag: false,
    latencyMs: 120,
    usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
    executionStatus: "grounded",
    breakdown: {
      rubricVersion: "practical_v1",
      caseCategory: "single_source_factual",
      expectedOutcome: "grounded_answer",
      passed: true,
      score: 1,
      notes: "",
      failureReasons: [],
      dimensions: {
        retrieval_source_hit: dimension("retrieval_source_hit", { passed: true }),
        evidence_relevance: dimension("evidence_relevance", { passed: true }),
        answer_groundedness: dimension("answer_groundedness", { passed: true }),
        answer_usefulness: dimension("answer_usefulness", { passed: true }),
        refusal_quality: dimension("refusal_quality", {
          passed: null,
          applicable: false,
          score: null,
        }),
        citation_integrity: dimension("citation_integrity", { passed: true }),
      },
      sourceHit: true,
      evidenceRelevant: true,
      grounded: true,
      useful: true,
      citationIntegrity: true,
      correctRefusal: false,
      expectedSourceCited: true,
      answerMatchScore: 1,
      requiresHumanReview: false,
      secondaryMetrics: {
        latencyMs: 120,
        usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
        topScore: 0.8,
        citationCount: 1,
        retrievedSourceCount: 1,
        distinctRetrievedDocuments: 1,
        distinctCitedDocuments: 1,
      },
    },
    ...overrides,
  });

  it("aggregates run summaries with per-dimension denominators and usage totals", () => {
    const summary = buildRunSummary({
      runId: "run-1",
      items: [
        item(),
        item({
          evalCaseId: "case-2",
          question: "How should I recover after an indexing failure?",
          category: "single_source_factual",
          passed: false,
          score: 0.42,
          latencyMs: 200,
          usage: { inputTokens: 150, outputTokens: 30, totalTokens: 180 },
          breakdown: {
            ...item().breakdown,
            passed: false,
            score: 0.42,
            failureReasons: ["citation_integrity_failed", "answer_not_grounded"],
            dimensions: {
              ...item().breakdown.dimensions,
              answer_groundedness: dimension("answer_groundedness", { passed: false }),
              citation_integrity: dimension("citation_integrity", { passed: false }),
            },
            grounded: false,
            citationIntegrity: false,
            secondaryMetrics: {
              latencyMs: 200,
              usage: { inputTokens: 150, outputTokens: 30, totalTokens: 180 },
              topScore: 0.7,
              citationCount: 0,
              retrievedSourceCount: 1,
              distinctRetrievedDocuments: 1,
              distinctCitedDocuments: 0,
            },
          },
        }),
        item({
          evalCaseId: "case-3",
          question: "What is the vacation policy?",
          category: "out_of_scope",
          passed: true,
          score: 1,
          latencyMs: 40,
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          executionStatus: "out_of_scope",
          breakdown: {
            ...item().breakdown,
            caseCategory: "out_of_scope",
            expectedOutcome: "refusal",
            dimensions: {
              retrieval_source_hit: dimension("retrieval_source_hit", {
                passed: null,
                applicable: false,
                score: null,
              }),
              evidence_relevance: dimension("evidence_relevance", {
                passed: null,
                applicable: false,
                score: null,
              }),
              answer_groundedness: dimension("answer_groundedness", {
                passed: null,
                applicable: false,
                score: null,
              }),
              answer_usefulness: dimension("answer_usefulness", {
                passed: null,
                applicable: false,
                score: null,
              }),
              refusal_quality: dimension("refusal_quality", { passed: true }),
              citation_integrity: dimension("citation_integrity", { passed: true }),
            },
            correctRefusal: true,
            sourceHit: false,
            evidenceRelevant: false,
            grounded: false,
            useful: false,
            citationIntegrity: true,
            failureReasons: [],
            secondaryMetrics: {
              latencyMs: 40,
              usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
              topScore: 0,
              citationCount: 0,
              retrievedSourceCount: 0,
              distinctRetrievedDocuments: 0,
              distinctCitedDocuments: 0,
            },
          },
        }),
      ],
    });

    expect(summary.totalCases).toBe(3);
    expect(summary.passedCases).toBe(2);
    expect(summary.passRate).toBe(0.6667);
    expect(summary.retrievalHitRate).toBe(1);
    expect(summary.groundednessRate).toBe(0.5);
    expect(summary.refusalCorrectnessRate).toBe(1);
    expect(summary.citationIntegrityRate).toBe(0.6667);
    expect(summary.usageTotals.totalTokens).toBe(300);
    expect(summary.failureReasonCounts.citation_integrity_failed).toBe(1);
  });

  it("flags and reports meaningful regressions against the previous run", () => {
    const currentItem = item({
      score: 0.42,
      passed: false,
      regressionFlag: true,
      breakdown: {
        ...item().breakdown,
        passed: false,
        score: 0.42,
        failureReasons: ["citation_integrity_failed", "answer_not_grounded"],
        dimensions: {
          ...item().breakdown.dimensions,
          answer_groundedness: dimension("answer_groundedness", { passed: false }),
          citation_integrity: dimension("citation_integrity", { passed: false }),
        },
        grounded: false,
        citationIntegrity: false,
      },
    });

    expect(
      shouldFlagRegression({
        currentItem,
        previousItem: {
          evalCaseId: "case-1",
          passed: true,
          score: 1,
          latencyMs: 120,
          retrievedSourcesJson: {
            status: "grounded",
            breakdown: {
              sourceHit: true,
              grounded: true,
              correctRefusal: false,
              citationIntegrity: true,
              dimensions: item().breakdown.dimensions,
            },
          },
        },
      }),
    ).toBe(true);

    const summary = buildRunSummary({
      runId: "run-current",
      items: [currentItem],
      previousRun: {
        id: "run-prev",
        summaryJson: {
          totalCases: 1,
          passRate: 1,
          retrievalHitRate: 1,
          groundednessRate: 1,
          refusalCorrectnessRate: 0,
          citationIntegrityRate: 1,
          averageLatencyMs: 120,
          averageScore: 1,
          regressionCount: 0,
        },
        items: [
          {
            evalCaseId: "case-1",
            passed: true,
            score: 1,
            latencyMs: 120,
            retrievedSourcesJson: {
              status: "grounded",
              breakdown: {
                sourceHit: true,
                grounded: true,
                correctRefusal: false,
                citationIntegrity: true,
                dimensions: item().breakdown.dimensions,
              },
            },
          },
        ],
      },
    });

    expect(summary.comparisonToPrevious?.passRateDelta).toBe(-1);
    expect(summary.comparisonToPrevious?.groundednessRateDelta).toBe(-1);
    expect(summary.comparisonToPrevious?.citationIntegrityRateDelta).toBe(-1);
    expect(summary.comparisonToPrevious?.notableRegressions).toHaveLength(1);
    expect(summary.comparisonToPrevious?.meaningfulChanges.length).toBeGreaterThan(0);
    expect(
      buildSummaryOnlyComparison({
        currentSummary: summary as unknown as Record<string, unknown>,
        previousSummary: {
          totalCases: 1,
          passRate: 1,
          retrievalHitRate: 1,
          groundednessRate: 1,
          refusalCorrectnessRate: 0,
          citationIntegrityRate: 1,
          averageLatencyMs: 120,
          averageScore: 1,
          regressionCount: 0,
        },
        previousRunId: "run-prev",
      })?.previousRunId,
    ).toBe("run-prev");
  });
});
