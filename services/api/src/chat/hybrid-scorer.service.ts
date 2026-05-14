import { Injectable } from "@nestjs/common";
import { HYBRID_SCORE_WEIGHTS } from "./chat.constants";
import {
  NormalizedRetrievalQuery,
  RetrievalCandidate,
  RetrievalScoreWeights,
} from "./chat.types";
import { NormalizedChatFilters } from "./retrieval-query.repository";
import {
  clamp01,
  computePhraseCoverage,
  computeRecencyScore,
  computeTokenCoverage,
  extractMetadataTerms,
  isFaqLikeChunk,
  normalizeLexicalRank,
} from "./retrieval-scoring.utils";

@Injectable()
export class HybridScorerService {
  readonly weights: RetrievalScoreWeights = HYBRID_SCORE_WEIGHTS;

  mergeAndScore(params: {
    query: NormalizedRetrievalQuery;
    filters: NormalizedChatFilters;
    semanticCandidates: RetrievalCandidate[];
    lexicalCandidates: RetrievalCandidate[];
    rerankPoolLimit: number;
  }) {
    const merged = new Map<string, RetrievalCandidate>();

    const upsert = (candidate: RetrievalCandidate) => {
      const existing = merged.get(candidate.chunkId);
      if (!existing) {
        merged.set(candidate.chunkId, this.cloneCandidate(candidate));
        return;
      }

      merged.set(candidate.chunkId, this.mergeCandidate(existing, candidate));
    };

    params.semanticCandidates.forEach(upsert);
    params.lexicalCandidates.forEach(upsert);

    return Array.from(merged.values())
      .map((candidate) =>
        this.scoreCandidate(candidate, params.query, params.filters),
      )
      .sort((left, right) => this.compareCandidates(left, right))
      .slice(0, Math.max(1, params.rerankPoolLimit))
      .map((candidate, index) => ({
        ...candidate,
        debug: {
          ...candidate.debug,
          rankBeforeDedup: index + 1,
        },
      }));
  }

  private cloneCandidate(candidate: RetrievalCandidate): RetrievalCandidate {
    return {
      ...candidate,
      debug: {
        ...candidate.debug,
        retrievedBy: [...candidate.debug.retrievedBy],
        metadataSignals: [...candidate.debug.metadataSignals],
        structuralSignals: [...candidate.debug.structuralSignals],
      },
    };
  }

  private mergeCandidate(
    left: RetrievalCandidate,
    right: RetrievalCandidate,
  ): RetrievalCandidate {
    return {
      ...left,
      content: left.content || right.content,
      indexedAt: this.pickNewerDate(left.indexedAt, right.indexedAt),
      lexicalRank: this.pickBestRank(left.lexicalRank, right.lexicalRank),
      semanticRank: this.pickBestRank(left.semanticRank, right.semanticRank),
      lexicalScore: Math.max(left.lexicalScore, right.lexicalScore),
      semanticScore: Math.max(left.semanticScore, right.semanticScore),
      metadataScore: Math.max(left.metadataScore, right.metadataScore),
      recencyScore: Math.max(left.recencyScore, right.recencyScore),
      structuralScore: Math.max(left.structuralScore, right.structuralScore),
      hybridScore: Math.max(left.hybridScore, right.hybridScore),
      debug: {
        ...left.debug,
        retrievedBy: this.mergeRetrievedBy(
          left.debug.retrievedBy,
          right.debug.retrievedBy,
        ),
        rawSemanticDistance: this.pickLowerNumber(
          left.debug.rawSemanticDistance,
          right.debug.rawSemanticDistance,
        ),
        rawSemanticSimilarity: this.pickHigherNumber(
          left.debug.rawSemanticSimilarity,
          right.debug.rawSemanticSimilarity,
        ),
        rawLexicalScore: this.pickHigherNumber(
          left.debug.rawLexicalScore,
          right.debug.rawLexicalScore,
        ),
        metadataSignals: Array.from(
          new Set([
            ...left.debug.metadataSignals,
            ...right.debug.metadataSignals,
          ]),
        ),
        structuralSignals: Array.from(
          new Set([
            ...left.debug.structuralSignals,
            ...right.debug.structuralSignals,
          ]),
        ),
      },
    };
  }

  private scoreCandidate(
    candidate: RetrievalCandidate,
    query: NormalizedRetrievalQuery,
    filters: NormalizedChatFilters,
  ): RetrievalCandidate {
    const lexicalTokenCoverage = computeTokenCoverage(
      candidate.searchText,
      query.tokens,
    );
    const lexicalPhraseCoverage = computePhraseCoverage(
      candidate.searchText,
      query.phrases,
    );
    const lexicalScore = clamp01(
      0.55 * normalizeLexicalRank(candidate.debug.rawLexicalScore) +
        0.25 * lexicalTokenCoverage +
        0.2 * lexicalPhraseCoverage,
    );

    const { metadataScore, metadataSignals } = this.computeMetadataScore(
      candidate,
      query,
      filters,
    );
    const { structuralScore, structuralSignals } = this.computeStructuralScore(
      candidate,
      query,
    );
    const recencyScore = computeRecencyScore(
      candidate.indexedAt,
      query.freshnessIntent,
    );
    const hybridScore =
      this.weights.semantic * candidate.semanticScore +
      this.weights.lexical * lexicalScore +
      this.weights.metadata * metadataScore +
      this.weights.recency * recencyScore +
      this.weights.structural * structuralScore;

    return {
      ...candidate,
      lexicalScore,
      metadataScore,
      recencyScore,
      structuralScore,
      hybridScore: Number(hybridScore.toFixed(6)),
      debug: {
        ...candidate.debug,
        lexicalTokenCoverage: Number(lexicalTokenCoverage.toFixed(6)),
        lexicalPhraseCoverage: Number(lexicalPhraseCoverage.toFixed(6)),
        metadataSignals,
        structuralSignals,
        selectionReason: this.buildSelectionReason({
          candidate,
          lexicalTokenCoverage,
          lexicalPhraseCoverage,
          metadataSignals,
          metadataScore,
          structuralSignals,
          structuralScore,
          recencyScore,
          freshnessIntent: query.freshnessIntent,
        }),
      },
    };
  }

  private computeMetadataScore(
    candidate: RetrievalCandidate,
    query: NormalizedRetrievalQuery,
    filters: NormalizedChatFilters,
  ) {
    const scores: number[] = [];
    const signals: string[] = [];

    if (filters.documentIds.length) {
      const matched =
        candidate.debug.metadataSignals.includes("document_filter");
      scores.push(matched ? 1 : 0);
      if (matched) {
        signals.push("document filter matched");
      }
    }

    if (filters.languages.length) {
      const matched =
        candidate.debug.metadataSignals.includes("language_filter");
      scores.push(matched ? 1 : 0);
      if (matched) {
        signals.push("language filter matched");
      }
    }

    const metadataTerms = extractMetadataTerms(candidate.metadataJson);
    if (metadataTerms.length && (query.tokens.length || query.phrases.length)) {
      const metadataText = metadataTerms.join(" ");
      const tagCoverage = Math.max(
        computeTokenCoverage(metadataText, query.tokens),
        computePhraseCoverage(metadataText, query.phrases),
      );
      scores.push(tagCoverage);
      if (tagCoverage > 0) {
        signals.push("metadata tags aligned");
      }
    }

    return {
      metadataScore: scores.length
        ? Number(
            (
              scores.reduce((sum, value) => sum + value, 0) / scores.length
            ).toFixed(6),
          )
        : 0,
      metadataSignals: signals,
    };
  }

  private computeStructuralScore(
    candidate: RetrievalCandidate,
    query: NormalizedRetrievalQuery,
  ) {
    const sectionCoverage = Math.max(
      computeTokenCoverage(candidate.sectionTitle, query.tokens),
      computePhraseCoverage(candidate.sectionTitle, query.phrases),
    );
    const titleCoverage = Math.max(
      computeTokenCoverage(
        candidate.sourceTitle || candidate.documentTitle,
        query.tokens,
      ),
      computePhraseCoverage(
        candidate.sourceTitle || candidate.documentTitle,
        query.phrases,
      ),
    );
    const faqBonus = query.questionLike && isFaqLikeChunk(candidate) ? 1 : 0;

    const structuralSignals: string[] = [];
    if (sectionCoverage > 0) {
      structuralSignals.push("section title aligned");
    }
    if (titleCoverage > 0) {
      structuralSignals.push("source title aligned");
    }
    if (faqBonus > 0) {
      structuralSignals.push("faq style chunk");
    }

    return {
      structuralScore: Number(
        clamp01(
          0.55 * sectionCoverage + 0.3 * titleCoverage + 0.15 * faqBonus,
        ).toFixed(6),
      ),
      structuralSignals,
    };
  }

  private buildSelectionReason(params: {
    candidate: RetrievalCandidate;
    lexicalTokenCoverage: number;
    lexicalPhraseCoverage: number;
    metadataSignals: string[];
    metadataScore: number;
    structuralSignals: string[];
    structuralScore: number;
    recencyScore: number;
    freshnessIntent: boolean;
  }) {
    const reasons: string[] = [];

    if (params.candidate.debug.retrievedBy.length === 2) {
      reasons.push("semantic and lexical retrieval agreed");
    }
    if (params.candidate.semanticScore >= 0.75) {
      reasons.push("strong semantic match");
    } else if (params.candidate.semanticScore >= 0.55) {
      reasons.push("good semantic match");
    }
    if (params.lexicalPhraseCoverage > 0) {
      reasons.push("exact phrase match");
    } else if (params.lexicalTokenCoverage >= 0.6) {
      reasons.push("high lexical overlap");
    }
    if (params.metadataScore > 0 && params.metadataSignals.length) {
      reasons.push(params.metadataSignals[0]);
    }
    if (params.structuralScore >= 0.2 && params.structuralSignals.length) {
      reasons.push(params.structuralSignals[0]);
    }
    if (params.freshnessIntent && params.recencyScore >= 0.45) {
      reasons.push("fresh content for time-sensitive query");
    }

    return reasons.length
      ? reasons.slice(0, 3).join("; ")
      : "scored from available signals";
  }

  private compareCandidates(
    left: RetrievalCandidate,
    right: RetrievalCandidate,
  ) {
    if (right.hybridScore !== left.hybridScore) {
      return right.hybridScore - left.hybridScore;
    }
    if (right.semanticScore !== left.semanticScore) {
      return right.semanticScore - left.semanticScore;
    }
    if (right.lexicalScore !== left.lexicalScore) {
      return right.lexicalScore - left.lexicalScore;
    }
    if (right.metadataScore !== left.metadataScore) {
      return right.metadataScore - left.metadataScore;
    }
    if (right.structuralScore !== left.structuralScore) {
      return right.structuralScore - left.structuralScore;
    }
    const leftIndexedAt = left.indexedAt ? left.indexedAt.getTime() : 0;
    const rightIndexedAt = right.indexedAt ? right.indexedAt.getTime() : 0;
    if (rightIndexedAt !== leftIndexedAt) {
      return rightIndexedAt - leftIndexedAt;
    }
    return left.chunkId.localeCompare(right.chunkId);
  }

  private mergeRetrievedBy(
    left: Array<"semantic" | "lexical">,
    right: Array<"semantic" | "lexical">,
  ) {
    const merged = new Set([...left, ...right]);
    return (["semantic", "lexical"] as const).filter((source) =>
      merged.has(source),
    ) as Array<"semantic" | "lexical">;
  }

  private pickBestRank(left: number | null, right: number | null) {
    if (left === null) {
      return right;
    }
    if (right === null) {
      return left;
    }
    return Math.min(left, right);
  }

  private pickHigherNumber(left: number | null, right: number | null) {
    if (left === null) {
      return right;
    }
    if (right === null) {
      return left;
    }
    return Math.max(left, right);
  }

  private pickLowerNumber(left: number | null, right: number | null) {
    if (left === null) {
      return right;
    }
    if (right === null) {
      return left;
    }
    return Math.min(left, right);
  }

  private pickNewerDate(left: Date | null, right: Date | null) {
    if (!left) {
      return right;
    }
    if (!right) {
      return left;
    }
    return left.getTime() >= right.getTime() ? left : right;
  }
}
