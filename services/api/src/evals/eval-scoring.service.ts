import { Injectable } from "@nestjs/common";
import {
  getCitationLimit,
  GROUNDABLE_EVIDENCE_SCORE_THRESHOLD,
} from "../chat/chat.constants";
import {
  EVAL_GROUNDED_PASS_THRESHOLD,
  EVAL_GROUNDED_SCORE_WEIGHTS,
  EVAL_REFUSAL_SCORE_WEIGHTS,
  EVAL_RUBRIC_VERSION,
  getEvalCategoryRule,
} from "./eval-rubric";
import {
  EvalDimensionResult,
  EvalExecutionResult,
  EvalFailureReason,
  EvalRubricDimensionKind,
  EvalRubricDimensionName,
  EvalScoreResult,
  EvalSelectedSource,
} from "./eval.types";

type ScoreableEvalCase = {
  question: string;
  expectedAnswer?: string | null;
  expectedSourceDocumentId?: string | null;
  expectedSourceHint?: string | null;
  category?: string | null;
};

@Injectable()
export class EvalScoringService {
  scoreCase(
    evalCase: ScoreableEvalCase,
    execution: EvalExecutionResult,
  ): EvalScoreResult {
    const categoryRule = getEvalCategoryRule(evalCase.category);
    const expectedSourceId = evalCase.expectedSourceDocumentId ?? null;
    const expectedAnswer = evalCase.expectedAnswer?.trim() ?? "";
    const expectedSourceHint = evalCase.expectedSourceHint?.trim() ?? "";
    const requiresHumanReview =
      categoryRule.manualReviewOnly === true ||
      (!expectedAnswer && !expectedSourceHint);
    const secondaryMetrics = {
      latencyMs: execution.latencyMs,
      usage: execution.usage,
      topScore: Number(execution.topScore.toFixed(4)),
      citationCount: execution.citations.length,
      retrievedSourceCount: execution.selectedSources.length,
      distinctRetrievedDocuments: this.distinctDocumentCount(
        execution.selectedSources.map((source) => source.documentId),
      ),
      distinctCitedDocuments: this.distinctDocumentCount(
        execution.citations.map((citation) => citation.documentId),
      ),
    };

    const sourceHit = this.computeSourceHit(evalCase, execution);
    const citationIntegrity = this.computeCitationIntegrity(
      categoryRule.expectedOutcome,
      execution,
    );
    const groundedness =
      categoryRule.expectedOutcome === "grounded_answer"
        ? this.computeGroundedness(execution, sourceHit.sourceHit, citationIntegrity.score)
        : this.notApplicableDimension(
            "answer_groundedness",
            "heuristic",
            2,
            "Refusal cases are not graded on grounded answer quality.",
          );
    const answerUsefulness =
      categoryRule.expectedOutcome === "grounded_answer"
        ? this.computeAnswerUsefulness(evalCase, execution)
        : {
            dimension: this.notApplicableDimension(
              "answer_usefulness",
              "heuristic",
              2,
              "Refusal cases are not graded on answer usefulness.",
            ),
            scoreSignal: 0,
          };
    const evidenceRelevance =
      categoryRule.expectedOutcome === "grounded_answer"
        ? this.computeEvidenceRelevance(
            evalCase,
            execution,
            sourceHit.sourceHit,
            sourceHit.expectedSourceCited,
            requiresHumanReview,
            categoryRule.minDistinctCitedDocuments,
            categoryRule.requireExpectedSourceCitation === true,
          )
        : this.notApplicableDimension(
            "evidence_relevance",
            "heuristic",
            2,
            "Refusal cases are not graded on evidence relevance.",
          );
    const refusalQuality =
      categoryRule.expectedOutcome === "refusal"
        ? this.computeRefusalQuality(categoryRule.expectedRefusalStatuses ?? [], execution)
        : this.notApplicableDimension(
            "refusal_quality",
            "heuristic",
            2,
            "Grounded-answer cases are not graded on refusal quality.",
          );

    const dimensions: EvalScoreResult["dimensions"] = {
      retrieval_source_hit: sourceHit.dimension,
      evidence_relevance: evidenceRelevance,
      answer_groundedness: groundedness,
      answer_usefulness: answerUsefulness.dimension,
      refusal_quality: refusalQuality,
      citation_integrity: citationIntegrity,
    };

    const failureReasons: EvalFailureReason[] = [];
    const notes: string[] = [];
    const answerMatchScore = Number(
      Math.max(sourceHit.answerTargetCoverage, answerUsefulness.scoreSignal).toFixed(4),
    );

    if (categoryRule.expectedOutcome === "refusal") {
      if (refusalQuality.score !== 2) {
        failureReasons.push(
          refusalQuality.notes.includes("wrong refusal mode")
            ? "wrong_refusal_mode"
            : "incorrect_refusal",
        );
      }
      if (citationIntegrity.score !== 2) {
        failureReasons.push("citation_integrity_failed");
      }
      notes.push(refusalQuality.notes, citationIntegrity.notes);
    } else {
      if (!sourceHit.sourceHit) {
        failureReasons.push("expected_source_missing");
      }
      if (
        categoryRule.requireExpectedSourceCitation &&
        expectedSourceId &&
        !sourceHit.expectedSourceCited
      ) {
        failureReasons.push("expected_source_not_cited");
      }
      if (evidenceRelevance.score < 1) {
        failureReasons.push("weak_evidence_relevance");
      }
      if (groundedness.score < 2) {
        failureReasons.push("answer_not_grounded");
      }
      if ((answerUsefulness.dimension.score ?? 0) < 1) {
        failureReasons.push("answer_not_useful");
      }
      if (citationIntegrity.score < 2) {
        failureReasons.push("citation_integrity_failed");
      }
      if (
        categoryRule.minDistinctCitedDocuments &&
        secondaryMetrics.distinctCitedDocuments < categoryRule.minDistinctCitedDocuments
      ) {
        failureReasons.push("missing_multi_source_support");
      }

      notes.push(
        sourceHit.dimension.notes,
        evidenceRelevance.notes,
        groundedness.notes,
        answerUsefulness.dimension.notes,
        citationIntegrity.notes,
      );
    }

    if (requiresHumanReview) {
      notes.push(
        categoryRule.manualReviewOnly
          ? "This category still needs human review because the current eval runner cannot verify access-sensitive behavior end to end."
          : "No expected answer or source hint was configured, so usefulness and evidence relevance remain heuristic-only.",
      );
    }

    const score =
      categoryRule.expectedOutcome === "refusal"
        ? this.weightedRefusalScore(refusalQuality.score, citationIntegrity.score)
        : this.weightedGroundedScore(
            sourceHit.dimension.score ?? 0,
            evidenceRelevance.score ?? 0,
            groundedness.score ?? 0,
            answerUsefulness.dimension.score ?? 0,
            citationIntegrity.score ?? 0,
          );

    const passed =
      categoryRule.expectedOutcome === "refusal"
        ? refusalQuality.score === 2 && citationIntegrity.score === 2
        : failureReasons.length === 0 && score >= EVAL_GROUNDED_PASS_THRESHOLD;

    return {
      rubricVersion: EVAL_RUBRIC_VERSION,
      caseCategory: categoryRule.category,
      expectedOutcome: categoryRule.expectedOutcome,
      passed,
      score,
      notes: this.compactNotes(notes),
      failureReasons: [...new Set(failureReasons)],
      dimensions,
      sourceHit: sourceHit.sourceHit,
      evidenceRelevant: evidenceRelevance.passed === true,
      grounded: groundedness.passed === true,
      useful: answerUsefulness.dimension.passed === true,
      citationIntegrity: citationIntegrity.passed === true,
      correctRefusal: refusalQuality.passed === true,
      expectedSourceCited: sourceHit.expectedSourceCited,
      answerMatchScore,
      requiresHumanReview,
      secondaryMetrics,
    };
  }

  private computeSourceHit(evalCase: ScoreableEvalCase, execution: EvalExecutionResult) {
    const expectedSourceId = evalCase.expectedSourceDocumentId ?? null;
    const expectedSourceHint = evalCase.expectedSourceHint?.trim() ?? "";
    const selectedSourceText = this.buildEvidenceText(execution.selectedSources);
    const hintCoverage = expectedSourceHint
      ? this.termCoverage(selectedSourceText, expectedSourceHint)
      : 0;
    const sourceHit = expectedSourceId
      ? execution.selectedSources.some((source) => source.documentId === expectedSourceId)
      : expectedSourceHint
        ? hintCoverage >= 0.6
        : execution.selectedSources.length > 0;
    const expectedSourceCited = expectedSourceId
      ? execution.citations.some((citation) => citation.documentId === expectedSourceId)
      : false;

    let notes = "";
    if (expectedSourceId) {
      notes = sourceHit
        ? expectedSourceCited
          ? "Expected source was retrieved and cited."
          : "Expected source was retrieved but not cited."
        : "Expected source document was not present in retrieved evidence.";
    } else if (expectedSourceHint) {
      notes = sourceHit
        ? `Retrieved evidence covered the source hint (coverage ${hintCoverage.toFixed(2)}).`
        : `Retrieved evidence did not cover the source hint strongly enough (coverage ${hintCoverage.toFixed(2)}).`;
    } else {
      notes = sourceHit
        ? "At least one source was retrieved, but no explicit source expectation was configured."
        : "No evidence was retrieved.";
    }

    return {
      sourceHit,
      expectedSourceCited,
      answerTargetCoverage: hintCoverage,
      dimension: this.dimensionResult({
        name: "retrieval_source_hit",
        kind: "automated",
        score: sourceHit ? 1 : 0,
        maxScore: 1,
        passScore: 1,
        notes,
      }),
    };
  }

  private computeEvidenceRelevance(
    evalCase: ScoreableEvalCase,
    execution: EvalExecutionResult,
    sourceHit: boolean,
    expectedSourceCited: boolean,
    requiresHumanReview: boolean,
    minDistinctCitedDocuments?: number,
    requireExpectedSourceCitation?: boolean,
  ) {
    if (!execution.selectedSources.length) {
      return this.dimensionResult({
        name: "evidence_relevance",
        kind: "heuristic",
        score: 0,
        maxScore: 2,
        passScore: 1,
        notes: "No retrieved evidence was available to judge relevance.",
      });
    }

    const target =
      evalCase.expectedAnswer?.trim() ||
      evalCase.expectedSourceHint?.trim() ||
      "";
    const retrievedCoverage = target
      ? this.termCoverage(this.buildEvidenceText(execution.selectedSources), target)
      : 0;
    const citedCoverage = target
      ? this.termCoverage(this.buildCitationText(execution), target)
      : 0;
    const coverage = Math.max(retrievedCoverage, citedCoverage);

    let score = 0;
    let notes = "";

    if (!target) {
      score = sourceHit ? 1 : 0;
      notes = requiresHumanReview
        ? "No expected answer or hint was configured, so evidence relevance is capped at a partial heuristic score."
        : "Evidence relevance relied on source-hit only because no explicit answer target was configured.";
    } else if (coverage >= 0.55 && (sourceHit || citedCoverage >= 0.55)) {
      score = 2;
      notes = `Retrieved or cited evidence aligned well with the expected target (coverage ${coverage.toFixed(2)}).`;
    } else if (coverage >= 0.25 || sourceHit) {
      score = 1;
      notes = `Retrieved or cited evidence partially aligned with the expected target (coverage ${coverage.toFixed(2)}).`;
    } else {
      notes = `Retrieved evidence looked weak against the expected target (coverage ${coverage.toFixed(2)}).`;
    }

    if (
      minDistinctCitedDocuments &&
      execution.citations.length > 0 &&
      this.distinctDocumentCount(
        execution.citations.map((citation) => citation.documentId),
      ) < minDistinctCitedDocuments
    ) {
      score = Math.min(score, 1);
      notes = `${notes} Multi-source synthesis expected at least ${minDistinctCitedDocuments} cited documents.`;
    }

    if (requireExpectedSourceCitation && evalCase.expectedSourceDocumentId && !expectedSourceCited) {
      score = Math.min(score, 1);
      notes = `${notes} The expected source was not cited in the final answer.`;
    }

    return this.dimensionResult({
      name: "evidence_relevance",
      kind: "heuristic",
      score,
      maxScore: 2,
      passScore: 1,
      notes,
    });
  }

  private computeGroundedness(
    execution: EvalExecutionResult,
    sourceHit: boolean,
    citationIntegrityScore: number,
  ) {
    if (execution.status !== "grounded") {
      return this.dimensionResult({
        name: "answer_groundedness",
        kind: "heuristic",
        score: 0,
        maxScore: 2,
        passScore: 2,
        notes: `The model returned ${execution.status} instead of a grounded answer.`,
      });
    }

    if (!execution.citations.length) {
      return this.dimensionResult({
        name: "answer_groundedness",
        kind: "heuristic",
        score: 0,
        maxScore: 2,
        passScore: 2,
        notes: "The answer was marked grounded but carried no citations.",
      });
    }

    if (
      citationIntegrityScore === 2 &&
      (sourceHit || execution.topScore >= GROUNDABLE_EVIDENCE_SCORE_THRESHOLD)
    ) {
      return this.dimensionResult({
        name: "answer_groundedness",
        kind: "heuristic",
        score: 2,
        maxScore: 2,
        passScore: 2,
        notes: "The answer was grounded, cited, and backed by usable evidence strength.",
      });
    }

    return this.dimensionResult({
      name: "answer_groundedness",
      kind: "heuristic",
      score: 1,
      maxScore: 2,
      passScore: 2,
      notes:
        "The answer was grounded with citations, but either evidence strength or citation integrity remained weak.",
    });
  }

  private computeAnswerUsefulness(
    evalCase: ScoreableEvalCase,
    execution: EvalExecutionResult,
  ) {
    const answer = execution.answer.trim();
    if (!answer) {
      return {
        dimension: this.dimensionResult({
          name: "answer_usefulness",
          kind: "heuristic",
          score: 0,
          maxScore: 2,
          passScore: 1,
          notes: "The answer body was empty.",
        }),
        scoreSignal: 0,
      };
    }

    const expectedAnswer = evalCase.expectedAnswer?.trim() ?? "";
    const expectedHint = evalCase.expectedSourceHint?.trim() ?? "";
    const answerF1 = expectedAnswer ? this.lexicalF1(answer, expectedAnswer) : 0;
    const hintCoverage = expectedHint ? this.termCoverage(answer, expectedHint) : 0;
    const scoreSignal = Math.max(answerF1, hintCoverage);

    if (!expectedAnswer && !expectedHint) {
      return {
        dimension: this.dimensionResult({
          name: "answer_usefulness",
          kind: "heuristic",
          score: execution.status === "grounded" ? 1 : 0,
          maxScore: 2,
          passScore: 1,
          notes:
            "The answer may be useful, but no expected answer or hint was configured for automated correctness checking.",
        }),
        scoreSignal,
      };
    }

    const score = scoreSignal >= 0.65 ? 2 : scoreSignal >= 0.35 ? 1 : 0;
    const notes =
      score === 2
        ? `The answer overlapped well with the expected target (score ${scoreSignal.toFixed(2)}).`
        : score === 1
          ? `The answer partially matched the expected target (score ${scoreSignal.toFixed(2)}).`
          : `The answer overlapped weakly with the expected target (score ${scoreSignal.toFixed(2)}).`;

    return {
      dimension: this.dimensionResult({
        name: "answer_usefulness",
        kind: "heuristic",
        score,
        maxScore: 2,
        passScore: 1,
        notes,
      }),
      scoreSignal,
    };
  }

  private computeRefusalQuality(expectedStatuses: string[], execution: EvalExecutionResult) {
    if (execution.status === "grounded" || execution.citations.length > 0) {
      return this.dimensionResult({
        name: "refusal_quality",
        kind: "heuristic",
        score: 0,
        maxScore: 2,
        passScore: 2,
        notes: "The system returned a substantive answer or citations instead of refusing cleanly.",
      });
    }

    const statusMatches = expectedStatuses.includes(execution.status);
    const concise = execution.answer.trim().length <= 320;
    const refusalLike = this.looksLikeRefusal(execution.answer);

    if (statusMatches && concise && refusalLike) {
      return this.dimensionResult({
        name: "refusal_quality",
        kind: "heuristic",
        score: 2,
        maxScore: 2,
        passScore: 2,
        notes: "The refusal mode, brevity, and wording were appropriate.",
      });
    }

    if (statusMatches) {
      return this.dimensionResult({
        name: "refusal_quality",
        kind: "heuristic",
        score: 1,
        maxScore: 2,
        passScore: 2,
        notes: "The system refused, but the wording was verbose or not clearly refusal-shaped.",
      });
    }

    return this.dimensionResult({
      name: "refusal_quality",
      kind: "heuristic",
      score: 1,
      maxScore: 2,
      passScore: 2,
      notes: "The system refused without citations, but it used the wrong refusal mode for this case.",
    });
  }

  private computeCitationIntegrity(
    expectedOutcome: "grounded_answer" | "refusal",
    execution: EvalExecutionResult,
  ) {
    if (expectedOutcome === "refusal") {
      return this.dimensionResult({
        name: "citation_integrity",
        kind: "automated",
        score: execution.citations.length === 0 ? 2 : 0,
        maxScore: 2,
        passScore: 2,
        notes:
          execution.citations.length === 0
            ? "Refusal carried no citations as expected."
            : "Refusal response should not include citations.",
      });
    }

    if (!execution.citations.length) {
      return this.dimensionResult({
        name: "citation_integrity",
        kind: "automated",
        score: 0,
        maxScore: 2,
        passScore: 2,
        notes: "Grounded answers must include citations.",
      });
    }

    const sourceByChunk = new Map(
      execution.selectedSources.map((source) => [source.chunkId, source] as const),
    );
    const seenChunks = new Set<string>();
    const duplicateChunkId = execution.citations.find((citation) => {
      if (seenChunks.has(citation.chunkId)) {
        return true;
      }
      seenChunks.add(citation.chunkId);
      return false;
    });
    const missingSource = execution.citations.find(
      (citation) => !sourceByChunk.has(citation.chunkId),
    );
    const mismatchedDocument = execution.citations.find((citation) => {
      const source = sourceByChunk.get(citation.chunkId);
      return source ? source.documentId !== citation.documentId : false;
    });

    if (missingSource || mismatchedDocument) {
      return this.dimensionResult({
        name: "citation_integrity",
        kind: "automated",
        score: 0,
        maxScore: 2,
        passScore: 2,
        notes:
          "At least one citation did not map cleanly back to a retrieved source chunk.",
      });
    }

    if (duplicateChunkId || execution.citations.length > getCitationLimit()) {
      return this.dimensionResult({
        name: "citation_integrity",
        kind: "automated",
        score: 1,
        maxScore: 2,
        passScore: 2,
        notes:
          "Citations were structurally valid, but they contained duplicates or exceeded the configured limit.",
      });
    }

    return this.dimensionResult({
      name: "citation_integrity",
      kind: "automated",
      score: 2,
      maxScore: 2,
      passScore: 2,
      notes: "Citations were present, unique, and traceable to retrieved evidence.",
    });
  }

  private dimensionResult(params: {
    name: EvalRubricDimensionName;
    kind: EvalRubricDimensionKind;
    score: number;
    maxScore: number;
    passScore: number;
    notes: string;
  }): EvalDimensionResult {
    return {
      name: params.name,
      kind: params.kind,
      applicable: true,
      score: params.score,
      maxScore: params.maxScore,
      passed: params.score >= params.passScore,
      notes: params.notes,
    };
  }

  private notApplicableDimension(
    name: EvalRubricDimensionName,
    kind: EvalRubricDimensionKind,
    maxScore: number,
    notes: string,
  ): EvalDimensionResult {
    return {
      name,
      kind,
      applicable: false,
      score: null,
      maxScore,
      passed: null,
      notes,
    };
  }

  private weightedGroundedScore(
    sourceHitScore: number,
    evidenceRelevanceScore: number,
    groundednessScore: number,
    usefulnessScore: number,
    citationIntegrityScore: number,
  ) {
    const normalized =
      EVAL_GROUNDED_SCORE_WEIGHTS.retrieval_source_hit * sourceHitScore +
      EVAL_GROUNDED_SCORE_WEIGHTS.evidence_relevance *
        (evidenceRelevanceScore / 2) +
      EVAL_GROUNDED_SCORE_WEIGHTS.answer_groundedness *
        (groundednessScore / 2) +
      EVAL_GROUNDED_SCORE_WEIGHTS.answer_usefulness * (usefulnessScore / 2) +
      EVAL_GROUNDED_SCORE_WEIGHTS.citation_integrity *
        (citationIntegrityScore / 2);
    return Number(normalized.toFixed(4));
  }

  private weightedRefusalScore(refusalQualityScore: number, citationIntegrityScore: number) {
    const normalized =
      EVAL_REFUSAL_SCORE_WEIGHTS.refusal_quality * (refusalQualityScore / 2) +
      EVAL_REFUSAL_SCORE_WEIGHTS.citation_integrity * (citationIntegrityScore / 2);
    return Number(normalized.toFixed(4));
  }

  private buildEvidenceText(sources: EvalSelectedSource[]) {
    return sources
      .map((source) =>
        [source.documentTitle, source.section ?? "", source.snippet].join(" "),
      )
      .join(" ");
  }

  private buildCitationText(execution: EvalExecutionResult) {
    return execution.citations
      .map((citation) =>
        [citation.documentTitle, citation.section ?? "", citation.snippet].join(" "),
      )
      .join(" ");
  }

  private looksLikeRefusal(answer: string) {
    return /(could not|cannot|can't|do not have|don't have|not enough|no relevant|available sources|support material|knowledge base)/i.test(
      answer,
    );
  }

  private lexicalF1(actual: string, expected: string) {
    const actualTerms = new Set(this.significantTerms(actual));
    const expectedTerms = new Set(this.significantTerms(expected));
    if (!actualTerms.size || !expectedTerms.size) {
      return 0;
    }

    let overlap = 0;
    actualTerms.forEach((term) => {
      if (expectedTerms.has(term)) {
        overlap += 1;
      }
    });

    const precision = overlap / actualTerms.size;
    const recall = overlap / expectedTerms.size;
    if (!precision || !recall) {
      return 0;
    }

    return (2 * precision * recall) / (precision + recall);
  }

  private termCoverage(actual: string, expected: string) {
    const actualTerms = new Set(this.significantTerms(actual));
    const expectedTerms = this.significantTerms(expected);
    if (!actualTerms.size || !expectedTerms.length) {
      return 0;
    }

    const matched = expectedTerms.filter((term) => actualTerms.has(term));
    return matched.length / expectedTerms.length;
  }

  private significantTerms(input: string) {
    return input
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3)
      .filter((token) => !STOP_WORDS.has(token));
  }

  private distinctDocumentCount(values: string[]) {
    return new Set(values).size;
  }

  private compactNotes(notes: string[]) {
    return notes
      .map((note) => note.trim())
      .filter(Boolean)
      .join(" ");
  }
}

const STOP_WORDS = new Set([
  "about",
  "after",
  "before",
  "from",
  "have",
  "into",
  "that",
  "their",
  "them",
  "they",
  "this",
  "what",
  "when",
  "where",
  "which",
  "while",
  "with",
]);
