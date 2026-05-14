import {
  CitationAssemblyDebug,
  ChatStatus,
  CitationView,
  RetrievalDebugView,
  UsageView,
} from "../chat/chat.types";
import { EvalCaseCategory, EvalExpectedOutcome } from "./eval-rubric";

export type EvalRubricDimensionName =
  | "retrieval_source_hit"
  | "evidence_relevance"
  | "answer_groundedness"
  | "answer_usefulness"
  | "refusal_quality"
  | "citation_integrity";

export type EvalRubricDimensionKind = "automated" | "heuristic" | "manual_review";

export type EvalFailureReason =
  | "expected_source_missing"
  | "expected_source_not_cited"
  | "weak_evidence_relevance"
  | "answer_not_grounded"
  | "answer_not_useful"
  | "incorrect_refusal"
  | "wrong_refusal_mode"
  | "citation_integrity_failed"
  | "missing_multi_source_support"
  | "case_requires_human_review"
  | "execution_failed";

export type EvalSelectedSource = {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  score: number;
  page: number | null;
  section: string | null;
  snippet: string;
};

export type EvalExecutionResult = {
  status: ChatStatus;
  answer: string;
  citations: CitationView[];
  usage: UsageView;
  latencyMs: number;
  selectedSources: EvalSelectedSource[];
  topScore: number;
  retrievalDebug?: RetrievalDebugView;
  citationDebug?: CitationAssemblyDebug;
};

export type EvalDimensionResult = {
  name: EvalRubricDimensionName;
  kind: EvalRubricDimensionKind;
  applicable: boolean;
  score: number | null;
  maxScore: number;
  passed: boolean | null;
  notes: string;
};

export type EvalSecondaryMetrics = {
  latencyMs: number;
  usage: UsageView;
  topScore: number;
  citationCount: number;
  retrievedSourceCount: number;
  distinctRetrievedDocuments: number;
  distinctCitedDocuments: number;
};

export type EvalScoreResult = {
  rubricVersion: string;
  caseCategory: EvalCaseCategory;
  expectedOutcome: EvalExpectedOutcome;
  passed: boolean;
  score: number;
  notes: string;
  failureReasons: EvalFailureReason[];
  dimensions: Record<EvalRubricDimensionName, EvalDimensionResult>;
  sourceHit: boolean;
  evidenceRelevant: boolean;
  grounded: boolean;
  useful: boolean;
  citationIntegrity: boolean;
  correctRefusal: boolean;
  expectedSourceCited: boolean;
  answerMatchScore: number;
  requiresHumanReview: boolean;
  secondaryMetrics: EvalSecondaryMetrics;
};

export type EvalMetricSummary = {
  applicableCases: number;
  passedCases: number;
  rate: number;
};

export type EvalRunItemSnapshot = {
  evalCaseId: string;
  question: string;
  category: string | null;
  passed: boolean;
  score: number;
  regressionFlag: boolean;
  latencyMs: number | null;
  usage: UsageView;
  executionStatus: ChatStatus;
  breakdown: EvalScoreResult;
};

export type EvalCaseRegression = {
  evalCaseId: string;
  question: string;
  category: string | null;
  previousPassed: boolean;
  currentPassed: boolean;
  previousScore: number;
  currentScore: number;
  scoreDelta: number;
  previousStatus: string | null;
  currentStatus: string;
  changedDimensions: EvalRubricDimensionName[];
  failureReasons: EvalFailureReason[];
};

export type EvalMeaningfulChange = {
  metric:
    | "pass_rate"
    | "retrieval_hit_rate"
    | "groundedness_rate"
    | "refusal_correctness_rate"
    | "citation_integrity_rate"
    | "average_latency_ms"
    | "average_score";
  direction: "improved" | "regressed";
  delta: number;
  threshold: number;
  note: string;
};

export type EvalRunComparison = {
  previousRunId: string;
  passRateDelta: number;
  retrievalHitRateDelta: number;
  groundednessRateDelta: number;
  refusalCorrectnessRateDelta: number;
  citationIntegrityRateDelta: number;
  averageLatencyDeltaMs: number;
  averageScoreDelta: number;
  regressionCountDelta: number;
  notableRegressions: EvalCaseRegression[];
  meaningfulChanges: EvalMeaningfulChange[];
};

export type EvalRunSummary = {
  rubricVersion: string;
  runId: string;
  totalCases: number;
  passedCases: number;
  passRate: number;
  retrievalHitRate: number;
  evidenceRelevanceRate: number;
  groundednessRate: number;
  usefulnessRate: number;
  refusalCorrectnessRate: number;
  citationIntegrityRate: number;
  averageLatencyMs: number;
  averageScore: number;
  regressionCount: number;
  statusBreakdown: Record<string, number>;
  failureReasonCounts: Record<string, number>;
  categoryBreakdown: Record<
    string,
    {
      totalCases: number;
      passedCases: number;
      passRate: number;
    }
  >;
  usageTotals: UsageView;
  usageAverages: UsageView;
  metrics: Record<EvalRubricDimensionName, EvalMetricSummary>;
  comparisonToPrevious?: EvalRunComparison;
};
