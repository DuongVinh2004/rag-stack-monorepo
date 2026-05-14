import {
  EvalCaseRegression,
  EvalFailureReason,
  EvalMeaningfulChange,
  EvalRunComparison,
  EvalRunItemSnapshot,
  EvalRunSummary,
  EvalRubricDimensionName,
  EvalScoreResult,
} from "./eval.types";
import { ChatStatus, UsageView } from "../chat/chat.types";
import { EVAL_RUBRIC_VERSION } from "./eval-rubric";

type StoredEvalItem = {
  evalCaseId: string;
  passed: boolean;
  score: number;
  latencyMs: number | null;
  notes?: string | null;
  retrievedSourcesJson?: unknown;
};

type PreviousRunSnapshot = {
  id: string;
  summaryJson: Record<string, unknown> | null;
  items: StoredEvalItem[];
};

const DIMENSION_NAMES: EvalRubricDimensionName[] = [
  "retrieval_source_hit",
  "evidence_relevance",
  "answer_groundedness",
  "answer_usefulness",
  "refusal_quality",
  "citation_integrity",
];

const CRITICAL_DIMENSIONS: EvalRubricDimensionName[] = [
  "retrieval_source_hit",
  "answer_groundedness",
  "refusal_quality",
  "citation_integrity",
];

export function buildRunSummary(params: {
  runId: string;
  items: EvalRunItemSnapshot[];
  previousRun?: PreviousRunSnapshot | null;
}): EvalRunSummary {
  const totalCases = params.items.length;
  const passedCases = params.items.filter((item) => item.passed).length;
  const regressionCount = params.items.filter((item) => item.regressionFlag).length;
  const passRate = rate(passedCases, totalCases);
  const averageLatencyMs = average(
    params.items
      .map((item) => item.latencyMs)
      .filter((value): value is number => value !== null),
  );
  const averageScore = average(params.items.map((item) => item.score));
  const usageTotals = params.items.reduce(
    (acc, item) => ({
      inputTokens: acc.inputTokens + item.usage.inputTokens,
      outputTokens: acc.outputTokens + item.usage.outputTokens,
      totalTokens: acc.totalTokens + item.usage.totalTokens,
    }),
    emptyUsage(),
  );
  const usageAverages = {
    inputTokens: round(average(params.items.map((item) => item.usage.inputTokens)), 2),
    outputTokens: round(
      average(params.items.map((item) => item.usage.outputTokens)),
      2,
    ),
    totalTokens: round(average(params.items.map((item) => item.usage.totalTokens)), 2),
  };

  const metrics = DIMENSION_NAMES.reduce<EvalRunSummary["metrics"]>((acc, name) => {
    const applicableItems = params.items.filter(
      (item) => item.breakdown.dimensions[name].applicable,
    );
    const passedItems = applicableItems.filter(
      (item) => item.breakdown.dimensions[name].passed === true,
    );
    acc[name] = {
      applicableCases: applicableItems.length,
      passedCases: passedItems.length,
      rate: rate(passedItems.length, applicableItems.length),
    };
    return acc;
  }, {} as EvalRunSummary["metrics"]);

  const statusBreakdown = params.items.reduce<Record<string, number>>((acc, item) => {
    acc[item.executionStatus] = (acc[item.executionStatus] ?? 0) + 1;
    return acc;
  }, {});

  const failureReasonCounts = params.items.reduce<Record<string, number>>((acc, item) => {
    item.breakdown.failureReasons.forEach((reason) => {
      acc[reason] = (acc[reason] ?? 0) + 1;
    });
    return acc;
  }, {});

  const categoryBreakdown = params.items.reduce<EvalRunSummary["categoryBreakdown"]>(
    (acc, item) => {
      const key = item.breakdown.caseCategory;
      const entry = acc[key] ?? {
        totalCases: 0,
        passedCases: 0,
        passRate: 0,
      };
      entry.totalCases += 1;
      if (item.passed) {
        entry.passedCases += 1;
      }
      entry.passRate = rate(entry.passedCases, entry.totalCases);
      acc[key] = entry;
      return acc;
    },
    {},
  );

  const summary: EvalRunSummary = {
    rubricVersion: EVAL_RUBRIC_VERSION,
    runId: params.runId,
    totalCases,
    passedCases,
    passRate,
    retrievalHitRate: metrics.retrieval_source_hit.rate,
    evidenceRelevanceRate: metrics.evidence_relevance.rate,
    groundednessRate: metrics.answer_groundedness.rate,
    usefulnessRate: metrics.answer_usefulness.rate,
    refusalCorrectnessRate: metrics.refusal_quality.rate,
    citationIntegrityRate: metrics.citation_integrity.rate,
    averageLatencyMs: round(averageLatencyMs, 2),
    averageScore: round(averageScore, 4),
    regressionCount,
    statusBreakdown,
    failureReasonCounts,
    categoryBreakdown,
    usageTotals,
    usageAverages,
    metrics,
  };

  if (params.previousRun) {
    summary.comparisonToPrevious = buildRunComparison({
      currentItems: params.items,
      currentSummary: summary,
      previousRun: params.previousRun,
    });
  }

  return summary;
}

export function buildSummaryOnlyComparison(params: {
  currentSummary: Record<string, unknown>;
  previousSummary: Record<string, unknown> | null;
  previousRunId?: string;
}): EvalRunComparison | null {
  if (!params.previousSummary || !params.previousRunId) {
    return null;
  }

  const previousTotalCases = numberValue(params.previousSummary.totalCases);
  const currentTotalCases = numberValue(params.currentSummary.totalCases);
  const rateThreshold = meaningfulRateThreshold(currentTotalCases, previousTotalCases);
  const previousLatency = numberValue(params.previousSummary.averageLatencyMs);
  const latencyThreshold = meaningfulLatencyThreshold(previousLatency);

  const comparison: EvalRunComparison = {
    previousRunId: params.previousRunId,
    passRateDelta: delta(params.currentSummary.passRate, params.previousSummary.passRate),
    retrievalHitRateDelta: delta(
      params.currentSummary.retrievalHitRate,
      params.previousSummary.retrievalHitRate,
    ),
    groundednessRateDelta: delta(
      params.currentSummary.groundednessRate,
      params.previousSummary.groundednessRate,
    ),
    refusalCorrectnessRateDelta: delta(
      params.currentSummary.refusalCorrectnessRate,
      params.previousSummary.refusalCorrectnessRate,
    ),
    citationIntegrityRateDelta: delta(
      params.currentSummary.citationIntegrityRate,
      params.previousSummary.citationIntegrityRate,
    ),
    averageLatencyDeltaMs: delta(
      params.currentSummary.averageLatencyMs,
      params.previousSummary.averageLatencyMs,
    ),
    averageScoreDelta: delta(
      params.currentSummary.averageScore,
      params.previousSummary.averageScore,
    ),
    regressionCountDelta: delta(
      params.currentSummary.regressionCount,
      params.previousSummary.regressionCount,
    ),
    notableRegressions: [],
    meaningfulChanges: [],
  };

  comparison.meaningfulChanges = buildMeaningfulChanges({
    comparison,
    latencyThreshold,
    rateThreshold,
  });

  return comparison;
}

export function shouldFlagRegression(params: {
  currentItem: EvalRunItemSnapshot;
  previousItem: StoredEvalItem | null | undefined;
}) {
  const previousItem = params.previousItem;
  if (!previousItem) {
    return false;
  }

  if (previousItem.passed && !params.currentItem.passed) {
    return true;
  }

  if (previousItem.score - params.currentItem.score >= 0.2) {
    return true;
  }

  return CRITICAL_DIMENSIONS.some((dimension) => {
    const previousPassed = storedDimensionPassed(previousItem, dimension);
    const currentPassed = params.currentItem.breakdown.dimensions[dimension].passed;
    return previousPassed === true && currentPassed === false;
  });
}

function buildRunComparison(params: {
  currentSummary: EvalRunSummary;
  currentItems: EvalRunItemSnapshot[];
  previousRun: PreviousRunSnapshot;
}): EvalRunComparison {
  const previousSummary = resolvePreviousSummary(
    params.previousRun.summaryJson,
    params.previousRun.items,
    params.previousRun.id,
  );
  const comparison = buildSummaryOnlyComparison({
    currentSummary: params.currentSummary as unknown as Record<string, unknown>,
    previousSummary: previousSummary as unknown as Record<string, unknown>,
    previousRunId: params.previousRun.id,
  });

  if (!comparison) {
    throw new Error("Comparison requires a previous run");
  }

  comparison.notableRegressions = buildNotableRegressions(
    params.currentItems,
    params.previousRun.items,
  );
  return comparison;
}

function resolvePreviousSummary(
  summaryJson: Record<string, unknown> | null,
  items: StoredEvalItem[],
  runId: string,
): EvalRunSummary {
  if (
    summaryJson &&
    typeof summaryJson.passRate === "number" &&
    typeof summaryJson.retrievalHitRate === "number" &&
    typeof summaryJson.groundednessRate === "number" &&
    typeof summaryJson.refusalCorrectnessRate === "number" &&
    typeof summaryJson.citationIntegrityRate === "number"
  ) {
    return summaryJson as unknown as EvalRunSummary;
  }

  const reconstructedItems = items.map((item) => reconstructItemSnapshot(item));
  return buildRunSummary({
    runId,
    items: reconstructedItems,
  });
}

function reconstructItemSnapshot(item: StoredEvalItem): EvalRunItemSnapshot {
  const breakdown = reconstructScoreResult(item);
  return {
    evalCaseId: item.evalCaseId,
    question: "",
    category: breakdown.caseCategory,
    passed: item.passed,
    score: item.score,
    regressionFlag: false,
    latencyMs: item.latencyMs,
    usage: breakdown.secondaryMetrics.usage,
    executionStatus: extractStoredStatus(item.retrievedSourcesJson) ?? "insufficient_data",
    breakdown,
  };
}

function reconstructScoreResult(item: StoredEvalItem): EvalScoreResult {
  const storedBreakdown = extractStoredBreakdown(item.retrievedSourcesJson);
  const dimensions = DIMENSION_NAMES.reduce<EvalScoreResult["dimensions"]>((acc, name) => {
    const passed = storedDimensionPassed(item, name);
    const applicable = storedDimensionApplicable(item, name);
    acc[name] = {
      name,
      kind: name === "retrieval_source_hit" || name === "citation_integrity" ? "automated" : "heuristic",
      applicable,
      score: applicable ? (passed ? maxScoreForDimension(name) : 0) : null,
      maxScore: maxScoreForDimension(name),
      passed: applicable ? passed : null,
      notes: "",
    };
    return acc;
  }, {} as EvalScoreResult["dimensions"]);

  const failureReasons = Array.isArray(storedBreakdown?.failureReasons)
    ? (storedBreakdown.failureReasons.filter((reason): reason is EvalFailureReason =>
        typeof reason === "string",
      ) as EvalFailureReason[])
    : item.passed
      ? []
      : [];
  const usage = extractStoredUsage(item.retrievedSourcesJson);
  const sourceHit = storedDimensionPassed(item, "retrieval_source_hit") === true;
  const grounded = storedDimensionPassed(item, "answer_groundedness") === true;
  const correctRefusal = storedDimensionPassed(item, "refusal_quality") === true;
  const citationIntegrity = storedDimensionPassed(item, "citation_integrity") === true;
  const useful = storedDimensionPassed(item, "answer_usefulness") === true;
  const evidenceRelevant = storedDimensionPassed(item, "evidence_relevance") === true;

  return {
    rubricVersion:
      typeof storedBreakdown?.rubricVersion === "string"
        ? storedBreakdown.rubricVersion
        : EVAL_RUBRIC_VERSION,
    caseCategory:
      typeof storedBreakdown?.caseCategory === "string"
        ? (storedBreakdown.caseCategory as EvalScoreResult["caseCategory"])
        : "general",
    expectedOutcome:
      storedBreakdown?.expectedOutcome === "refusal"
        ? "refusal"
        : "grounded_answer",
    passed: item.passed,
    score: item.score,
    notes: item.notes ?? "",
    failureReasons,
    dimensions,
    sourceHit,
    evidenceRelevant,
    grounded,
    useful,
    citationIntegrity,
    correctRefusal,
    expectedSourceCited: Boolean(storedBreakdown?.expectedSourceCited),
    answerMatchScore: numberValue(storedBreakdown?.answerMatchScore),
    requiresHumanReview: Boolean(storedBreakdown?.requiresHumanReview),
    secondaryMetrics: {
      latencyMs: item.latencyMs ?? 0,
      usage,
      topScore: numberValue(extractStoredObject(item.retrievedSourcesJson)?.topScore),
      citationCount: extractStoredCitationCount(item.retrievedSourcesJson),
      retrievedSourceCount: extractStoredSourceCount(item.retrievedSourcesJson),
      distinctRetrievedDocuments: extractStoredDistinctDocumentCount(
        item.retrievedSourcesJson,
        "sources",
      ),
      distinctCitedDocuments: extractStoredDistinctDocumentCount(
        item.retrievedSourcesJson,
        "citations",
      ),
    },
  };
}

function buildNotableRegressions(
  currentItems: EvalRunItemSnapshot[],
  previousItems: StoredEvalItem[],
) {
  const previousMap = new Map(previousItems.map((item) => [item.evalCaseId, item]));

  return currentItems
    .filter((item) =>
      shouldFlagRegression({
        currentItem: item,
        previousItem: previousMap.get(item.evalCaseId),
      }),
    )
    .map<EvalCaseRegression>((item) => {
      const previousItem = previousMap.get(item.evalCaseId)!;
      const changedDimensions = DIMENSION_NAMES.filter((dimension) => {
        const previousPassed = storedDimensionPassed(previousItem, dimension);
        const currentPassed = item.breakdown.dimensions[dimension].passed;
        return previousPassed === true && currentPassed === false;
      });

      return {
        evalCaseId: item.evalCaseId,
        question: item.question,
        category: item.category,
        previousPassed: previousItem.passed,
        currentPassed: item.passed,
        previousScore: round(previousItem.score, 4),
        currentScore: round(item.score, 4),
        scoreDelta: round(item.score - previousItem.score, 4),
        previousStatus: extractStoredStatus(previousItem.retrievedSourcesJson),
        currentStatus: item.executionStatus,
        changedDimensions,
        failureReasons: item.breakdown.failureReasons,
      };
    })
    .sort((left, right) => {
      if (left.previousPassed !== right.previousPassed) {
        return left.previousPassed ? -1 : 1;
      }
      return left.scoreDelta - right.scoreDelta;
    })
    .slice(0, 10);
}

function buildMeaningfulChanges(params: {
  comparison: EvalRunComparison;
  rateThreshold: number;
  latencyThreshold: number;
}): EvalMeaningfulChange[] {
  const changes: EvalMeaningfulChange[] = [];
  pushRateChange(
    changes,
    "pass_rate",
    params.comparison.passRateDelta,
    params.rateThreshold,
  );
  pushRateChange(
    changes,
    "retrieval_hit_rate",
    params.comparison.retrievalHitRateDelta,
    params.rateThreshold,
  );
  pushRateChange(
    changes,
    "groundedness_rate",
    params.comparison.groundednessRateDelta,
    params.rateThreshold,
  );
  pushRateChange(
    changes,
    "refusal_correctness_rate",
    params.comparison.refusalCorrectnessRateDelta,
    params.rateThreshold,
  );
  pushRateChange(
    changes,
    "citation_integrity_rate",
    params.comparison.citationIntegrityRateDelta,
    params.rateThreshold,
  );
  pushRateChange(
    changes,
    "average_score",
    params.comparison.averageScoreDelta,
    params.rateThreshold,
  );

  if (Math.abs(params.comparison.averageLatencyDeltaMs) >= params.latencyThreshold) {
    changes.push({
      metric: "average_latency_ms",
      direction:
        params.comparison.averageLatencyDeltaMs < 0 ? "improved" : "regressed",
      delta: round(params.comparison.averageLatencyDeltaMs, 4),
      threshold: round(params.latencyThreshold, 4),
      note:
        params.comparison.averageLatencyDeltaMs < 0
          ? "Average latency dropped materially."
          : "Average latency increased materially.",
    });
  }

  return changes;
}

function pushRateChange(
  changes: EvalMeaningfulChange[],
  metric: EvalMeaningfulChange["metric"],
  value: number,
  threshold: number,
) {
  if (Math.abs(value) < threshold) {
    return;
  }

  changes.push({
    metric,
    direction: value > 0 ? "improved" : "regressed",
    delta: round(value, 4),
    threshold: round(threshold, 4),
    note:
      value > 0
        ? `${metric} improved materially.`
        : `${metric} regressed materially.`,
  });
}

function storedDimensionApplicable(
  item: StoredEvalItem,
  dimension: EvalRubricDimensionName,
) {
  const breakdown = extractStoredBreakdown(item.retrievedSourcesJson);
  const storedDimensions = extractStoredDimensions(breakdown);
  const storedDimension = storedDimensions?.[dimension];
  if (storedDimension && typeof storedDimension.applicable === "boolean") {
    return storedDimension.applicable;
  }

  const expectedOutcome =
    breakdown?.expectedOutcome === "refusal" ? "refusal" : "grounded_answer";

  if (dimension === "refusal_quality") {
    return expectedOutcome === "refusal";
  }

  return expectedOutcome !== "refusal";
}

function storedDimensionPassed(
  item: StoredEvalItem,
  dimension: EvalRubricDimensionName,
) {
  const breakdown = extractStoredBreakdown(item.retrievedSourcesJson);
  const storedDimensions = extractStoredDimensions(breakdown);
  const storedDimension = storedDimensions?.[dimension];
  if (storedDimension && typeof storedDimension.passed === "boolean") {
    return storedDimension.passed;
  }

  const legacyBreakdown = breakdown;
  switch (dimension) {
    case "retrieval_source_hit":
      return legacyBreakdown?.sourceHit === true;
    case "answer_groundedness":
      return legacyBreakdown?.grounded === true;
    case "refusal_quality":
      return legacyBreakdown?.correctRefusal === true;
    case "citation_integrity": {
      const status = extractStoredStatus(item.retrievedSourcesJson);
      const citationCount = extractStoredCitationCount(item.retrievedSourcesJson);
      if (status === "grounded") {
        return citationCount > 0;
      }
      return citationCount === 0;
    }
    case "answer_usefulness":
      return numberValue(legacyBreakdown?.answerMatchScore) >= 0.45;
    case "evidence_relevance":
      return legacyBreakdown?.sourceHit === true;
  }
}

function extractStoredBreakdown(input: unknown) {
  const root = extractStoredObject(input);
  const raw = root?.breakdown;
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : undefined;
}

function extractStoredDimensions(input?: Record<string, unknown>) {
  const raw = input?.dimensions;
  return raw && typeof raw === "object"
    ? (raw as Record<string, Record<string, unknown>>)
    : undefined;
}

function extractStoredObject(input: unknown) {
  return input && typeof input === "object"
    ? (input as Record<string, unknown>)
    : undefined;
}

function extractStoredStatus(input: unknown) {
  const root = extractStoredObject(input);
  return root?.status === "grounded" ||
    root?.status === "insufficient_data" ||
    root?.status === "out_of_scope"
    ? (root.status as ChatStatus)
    : null;
}

function extractStoredUsage(input: unknown): UsageView {
  const root = extractStoredObject(input);
  const raw = root?.usage;
  if (!raw || typeof raw !== "object") {
    return emptyUsage();
  }

  const usage = raw as Record<string, unknown>;
  return {
    inputTokens: numberValue(usage.inputTokens),
    outputTokens: numberValue(usage.outputTokens),
    totalTokens: numberValue(usage.totalTokens),
  };
}

function extractStoredCitationCount(input: unknown) {
  const root = extractStoredObject(input);
  const citations = Array.isArray(root?.citations)
    ? root.citations
    : Array.isArray(root?.citationChunkIds)
      ? root.citationChunkIds
      : [];
  return citations.length;
}

function extractStoredSourceCount(input: unknown) {
  const root = extractStoredObject(input);
  return Array.isArray(root?.sources) ? root.sources.length : 0;
}

function extractStoredDistinctDocumentCount(
  input: unknown,
  field: "sources" | "citations",
) {
  const root = extractStoredObject(input);
  const entries = Array.isArray(root?.[field]) ? root[field] : [];
  const documentIds = new Set(
    entries
      .map((entry) =>
        entry && typeof entry === "object"
          ? (entry as Record<string, unknown>).documentId
          : null,
      )
      .filter((value): value is string => typeof value === "string"),
  );
  return documentIds.size;
}

function maxScoreForDimension(name: EvalRubricDimensionName) {
  return name === "retrieval_source_hit" ? 1 : 2;
}

function meaningfulRateThreshold(currentTotalCases: number, previousTotalCases: number) {
  return round(Math.max(0.05, 1 / Math.max(currentTotalCases, previousTotalCases, 1)), 4);
}

function meaningfulLatencyThreshold(previousAverageLatencyMs: number) {
  return round(Math.max(250, previousAverageLatencyMs * 0.2), 4);
}

function emptyUsage(): UsageView {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };
}

function average(values: number[]) {
  if (!values.length) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function rate(passed: number, total: number) {
  if (!total) {
    return 0;
  }

  return round(passed / total, 4);
}

function delta(current: unknown, previous: unknown) {
  return round(numberValue(current) - numberValue(previous), 4);
}

function round(value: number, digits: number) {
  return Number(value.toFixed(digits));
}

function numberValue(input: unknown) {
  const value = Number(input ?? 0);
  return Number.isFinite(value) ? value : 0;
}
