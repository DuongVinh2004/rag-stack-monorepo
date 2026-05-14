import { ChatStatus } from "../chat/chat.types";

export const EVAL_RUBRIC_VERSION = "practical_v1";
export const EVAL_GROUNDED_PASS_THRESHOLD = 0.7;
export const EVAL_GROUNDED_SCORE_WEIGHTS = {
  retrieval_source_hit: 0.25,
  evidence_relevance: 0.15,
  answer_groundedness: 0.25,
  answer_usefulness: 0.25,
  citation_integrity: 0.1,
} as const;
export const EVAL_REFUSAL_SCORE_WEIGHTS = {
  refusal_quality: 0.7,
  citation_integrity: 0.3,
} as const;
export const EVAL_CASE_CATEGORIES = [
  "general",
  "single_source_factual",
  "multi_source_synthesis",
  "version_recency_sensitive",
  "ambiguous_keyword_overlap",
  "out_of_scope",
  "insufficient_data",
  "refusal",
  "access_sensitive",
] as const;

export type EvalCaseCategory = (typeof EVAL_CASE_CATEGORIES)[number];
export type EvalExpectedOutcome = "grounded_answer" | "refusal";

export type EvalCategoryRule = {
  category: EvalCaseCategory;
  expectedOutcome: EvalExpectedOutcome;
  expectedRefusalStatuses?: ChatStatus[];
  minDistinctCitedDocuments?: number;
  requireExpectedSourceCitation?: boolean;
  manualReviewOnly?: boolean;
};

const CATEGORY_ALIASES: Record<string, EvalCaseCategory> = {
  ambiguous: "ambiguous_keyword_overlap",
  ambiguous_keyword: "ambiguous_keyword_overlap",
  ambiguous_keyword_overlap: "ambiguous_keyword_overlap",
  general: "general",
  insufficient: "insufficient_data",
  insufficient_data: "insufficient_data",
  multi_source: "multi_source_synthesis",
  multi_source_synthesis: "multi_source_synthesis",
  out_of_scope: "out_of_scope",
  recency_sensitive: "version_recency_sensitive",
  refusal: "refusal",
  single_source: "single_source_factual",
  single_source_factual: "single_source_factual",
  version_recency_sensitive: "version_recency_sensitive",
  version_sensitive: "version_recency_sensitive",
  access_sensitive: "access_sensitive",
};

const DEFAULT_CATEGORY: EvalCaseCategory = "general";

const CATEGORY_RULES: Record<EvalCaseCategory, EvalCategoryRule> = {
  general: {
    category: "general",
    expectedOutcome: "grounded_answer",
  },
  single_source_factual: {
    category: "single_source_factual",
    expectedOutcome: "grounded_answer",
  },
  multi_source_synthesis: {
    category: "multi_source_synthesis",
    expectedOutcome: "grounded_answer",
    minDistinctCitedDocuments: 2,
  },
  version_recency_sensitive: {
    category: "version_recency_sensitive",
    expectedOutcome: "grounded_answer",
    requireExpectedSourceCitation: true,
  },
  ambiguous_keyword_overlap: {
    category: "ambiguous_keyword_overlap",
    expectedOutcome: "grounded_answer",
    requireExpectedSourceCitation: true,
  },
  out_of_scope: {
    category: "out_of_scope",
    expectedOutcome: "refusal",
    expectedRefusalStatuses: ["out_of_scope"],
  },
  insufficient_data: {
    category: "insufficient_data",
    expectedOutcome: "refusal",
    expectedRefusalStatuses: ["insufficient_data"],
  },
  refusal: {
    category: "refusal",
    expectedOutcome: "refusal",
    expectedRefusalStatuses: ["insufficient_data", "out_of_scope"],
  },
  access_sensitive: {
    category: "access_sensitive",
    expectedOutcome: "grounded_answer",
    manualReviewOnly: true,
  },
};

export function normalizeEvalCategory(category?: string | null): EvalCaseCategory {
  const normalized = (category ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return CATEGORY_ALIASES[normalized] ?? DEFAULT_CATEGORY;
}

export function getEvalCategoryRule(category?: string | null): EvalCategoryRule {
  return CATEGORY_RULES[normalizeEvalCategory(category)];
}

export function isRefusalCategory(category?: string | null) {
  return getEvalCategoryRule(category).expectedOutcome === "refusal";
}
