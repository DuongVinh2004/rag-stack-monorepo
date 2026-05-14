import { Injectable } from "@nestjs/common";
import { JsonLogger } from "../common/observability/json-logger.service";
import { MetricsService } from "../common/observability/metrics.service";
import {
  getRetrievalGroundingLimit,
  getRetrievalLexicalCandidateLimit,
  getRetrievalRerankLimit,
  getRetrievalSemanticCandidateLimit,
} from "./chat.constants";
import { ChatFilters, RetrievalCandidate, RetrievalResult } from "./chat.types";
import { QueryNormalizerService } from "./query-normalizer.service";
import { OpenAiGatewayService } from "./openai-gateway.service";
import { HybridScorerService } from "./hybrid-scorer.service";
import {
  NormalizedChatFilters,
  RetrievalQueryRepository,
} from "./retrieval-query.repository";
import {
  computeJaccard,
  normalizeTextForMatch,
} from "./retrieval-scoring.utils";

@Injectable()
export class RetrievalService {
  constructor(
    private readonly queries: RetrievalQueryRepository,
    private readonly normalizer: QueryNormalizerService,
    private readonly openai: OpenAiGatewayService,
    private readonly scorer: HybridScorerService,
    private readonly metrics: MetricsService,
    private readonly logger: JsonLogger,
  ) {}

  async retrieve(params: {
    kbId: string;
    userId: string;
    isAdmin: boolean;
    query: string;
    filters?: ChatFilters;
    candidateLimit?: number;
    groundingLimit?: number;
    correlationId?: string;
  }): Promise<RetrievalResult> {
    const startedAt = Date.now();
    const normalizedQuery = this.normalizer.preprocess(params.query);
    const semanticCandidateLimit =
      params.candidateLimit ?? getRetrievalSemanticCandidateLimit();
    const lexicalCandidateLimit =
      params.candidateLimit ?? getRetrievalLexicalCandidateLimit();
    const rerankPoolLimit = params.candidateLimit ?? getRetrievalRerankLimit();
    const groundingLimit =
      params.groundingLimit ?? getRetrievalGroundingLimit();
    const normalizedFilters = this.normalizeFilters(params.filters);

    if (!normalizedQuery.normalizedText) {
      this.logger.log(
        {
          correlation_id: params.correlationId ?? null,
          event: "retrieval_skipped_empty_query",
          kb_id: params.kbId,
          request_id: params.correlationId ?? null,
        },
        RetrievalService.name,
      );
      return this.emptyResult({
        normalizedQuery: "",
        groundingLimit,
        lexicalCandidateLimit,
        rerankPoolLimit,
        semanticCandidateLimit,
      });
    }

    const embeddingStartedAt = Date.now();
    const queryEmbeddingResult = await this.openai.createQueryEmbedding(
      normalizedQuery.normalizedText,
      {
        correlationId: params.correlationId,
        kbId: params.kbId,
        requestType: "query_embedding",
      },
    );
    const embeddingMs = Date.now() - embeddingStartedAt;
    if (queryEmbeddingResult.status === "failed") {
      this.logger.warn(
        {
          correlation_id: params.correlationId ?? null,
          error_code: queryEmbeddingResult.errorCode,
          event: "retrieval_query_embedding_failed",
          kb_id: params.kbId,
          request_id: params.correlationId ?? null,
        },
        RetrievalService.name,
      );
    }

    const [semanticFetch, lexicalFetch] = await Promise.all([
      queryEmbeddingResult.status === "success"
        ? this.timeStage(() =>
            this.queries.fetchSemanticCandidates({
              kbId: params.kbId,
              userId: params.userId,
              isAdmin: params.isAdmin,
              queryEmbedding: queryEmbeddingResult.embedding,
              embeddingDim: queryEmbeddingResult.dimensions,
              embeddingModel: this.openai.configuredEmbeddingModel,
              filters: normalizedFilters,
              candidateLimit: semanticCandidateLimit,
            }),
          )
        : Promise.resolve({ result: [], durationMs: 0 }),
      normalizedQuery.lexicalText
        ? this.timeStage(() =>
            this.queries.fetchLexicalCandidates({
              kbId: params.kbId,
              userId: params.userId,
              isAdmin: params.isAdmin,
              normalizedQuery,
              filters: normalizedFilters,
              candidateLimit: lexicalCandidateLimit,
            }),
          )
        : Promise.resolve({ result: [], durationMs: 0 }),
    ]);

    const mergeRerankStartedAt = Date.now();
    const rankedCandidates = this.scorer.mergeAndScore({
      query: normalizedQuery,
      filters: normalizedFilters,
      semanticCandidates: semanticFetch.result,
      lexicalCandidates: lexicalFetch.result,
      rerankPoolLimit,
    });
    const mergeRerankMs = Date.now() - mergeRerankStartedAt;

    const dedupStartedAt = Date.now();
    const dedupedCandidates = this.suppressDuplicates(rankedCandidates);
    const dedupMs = Date.now() - dedupStartedAt;
    const totalMs = Date.now() - startedAt;
    const selectedChunks = dedupedCandidates.slice(0, groundingLimit);

    this.recordStageTiming("embedding", embeddingMs, params.kbId);
    this.recordStageTiming(
      "semantic_fetch",
      semanticFetch.durationMs,
      params.kbId,
    );
    this.recordStageTiming(
      "lexical_fetch",
      lexicalFetch.durationMs,
      params.kbId,
    );
    this.recordStageTiming("merge_rerank", mergeRerankMs, params.kbId);
    this.recordStageTiming("dedup", dedupMs, params.kbId);
    this.metrics.recordDuration("retrieval_total_duration_ms", totalMs, {
      kb_id: params.kbId,
    });

    if (selectedChunks.length === 0) {
      this.metrics.increment("retrieval_zero_hits_total", 1, {
        kb_id: params.kbId,
      });
    }

    this.logger.log(
      {
        correlation_id: params.correlationId ?? null,
        embedding_ok: queryEmbeddingResult.status === "success",
        event: "retrieval_completed",
        grounding_limit: groundingLimit,
        kb_id: params.kbId,
        lexical_candidate_count: lexicalFetch.result.length,
        lexical_used: lexicalFetch.result.length > 0,
        request_id: params.correlationId ?? null,
        semantic_candidate_count: semanticFetch.result.length,
        semantic_used: semanticFetch.result.length > 0,
        selected_count: selectedChunks.length,
        timings_ms: {
          dedup_ms: dedupMs,
          embedding_ms: embeddingMs,
          lexical_fetch_ms: lexicalFetch.durationMs,
          merge_rerank_ms: mergeRerankMs,
          semantic_fetch_ms: semanticFetch.durationMs,
          total_ms: totalMs,
        },
        top_chunk_id: selectedChunks[0]?.chunkId ?? null,
        top_score: selectedChunks[0]?.hybridScore ?? 0,
        total_candidates: rankedCandidates.length,
      },
      RetrievalService.name,
    );

    return {
      normalizedQuery: normalizedQuery.normalizedText,
      embeddingsEnabled: this.openai.embeddingsEnabled,
      semanticUsed: semanticFetch.result.length > 0,
      lexicalUsed: lexicalFetch.result.length > 0,
      totalCandidates: rankedCandidates.length,
      selectedChunks,
      debug: {
        query: {
          normalizedText: normalizedQuery.normalizedText,
          lexicalText: normalizedQuery.lexicalText,
          tokens: normalizedQuery.tokens,
          phrases: normalizedQuery.phrases,
          freshnessIntent: normalizedQuery.freshnessIntent,
        },
        limits: {
          semanticTopN: semanticCandidateLimit,
          lexicalTopN: lexicalCandidateLimit,
          rerankPoolLimit,
          groundingTopK: groundingLimit,
        },
        weights: this.scorer.weights,
        timingsMs: {
          embeddingMs,
          semanticFetchMs: semanticFetch.durationMs,
          lexicalFetchMs: lexicalFetch.durationMs,
          mergeRerankMs,
          dedupMs,
          totalMs,
        },
        rankedCandidates: rankedCandidates.map((candidate) => ({
          chunkId: candidate.chunkId,
          documentId: candidate.documentId,
          semanticScore: candidate.semanticScore,
          lexicalScore: candidate.lexicalScore,
          metadataMatchScore: candidate.metadataScore,
          recencyScore: candidate.recencyScore,
          structuralScore: candidate.structuralScore,
          finalScore: candidate.hybridScore,
          selectionReason: candidate.debug.selectionReason,
          rankBeforeDedup: candidate.debug.rankBeforeDedup,
          rankAfterDedup: candidate.debug.rankAfterDedup,
          retrievedBy: candidate.debug.retrievedBy,
          semanticRank: candidate.semanticRank,
          lexicalRank: candidate.lexicalRank,
          dedupReason: candidate.debug.dedupReason,
        })),
      },
    };
  }

  private emptyResult(params: {
    normalizedQuery: string;
    semanticCandidateLimit: number;
    lexicalCandidateLimit: number;
    rerankPoolLimit: number;
    groundingLimit: number;
  }): RetrievalResult {
    return {
      normalizedQuery: params.normalizedQuery,
      embeddingsEnabled: false,
      lexicalUsed: false,
      semanticUsed: false,
      totalCandidates: 0,
      selectedChunks: [],
      debug: {
        query: {
          normalizedText: params.normalizedQuery,
          lexicalText: params.normalizedQuery,
          tokens: [],
          phrases: [],
          freshnessIntent: false,
        },
        limits: {
          semanticTopN: params.semanticCandidateLimit,
          lexicalTopN: params.lexicalCandidateLimit,
          rerankPoolLimit: params.rerankPoolLimit,
          groundingTopK: params.groundingLimit,
        },
        weights: this.scorer.weights,
        timingsMs: {
          embeddingMs: 0,
          semanticFetchMs: 0,
          lexicalFetchMs: 0,
          mergeRerankMs: 0,
          dedupMs: 0,
          totalMs: 0,
        },
        rankedCandidates: [],
      },
    };
  }

  private normalizeFilters(filters?: ChatFilters): NormalizedChatFilters {
    return {
      documentIds: filters?.documentIds ?? [],
      languages: (filters?.languages ?? []).map((language) =>
        language.toLowerCase(),
      ),
    };
  }

  private suppressDuplicates(candidates: RetrievalCandidate[]) {
    const selected: RetrievalCandidate[] = [];

    candidates.forEach((candidate) => {
      const duplicateOf = selected.find((existing) =>
        this.dedupReason(existing, candidate),
      );
      if (!duplicateOf) {
        candidate.debug.rankAfterDedup = selected.length + 1;
        candidate.debug.dedupReason = null;
        selected.push(candidate);
        return;
      }

      const reason = this.dedupReason(duplicateOf, candidate);
      candidate.debug.rankAfterDedup = null;
      candidate.debug.dedupReason = reason;
    });

    return selected;
  }

  private dedupReason(left: RetrievalCandidate, right: RetrievalCandidate) {
    if (left.chunkId === right.chunkId || left.checksum === right.checksum) {
      return `duplicate of ${left.chunkId}`;
    }

    if (
      left.documentVersionId !== right.documentVersionId ||
      Math.abs(left.chunkNo - right.chunkNo) > 1
    ) {
      return null;
    }

    const overlap = computeJaccard(left.searchText, right.searchText);
    if (overlap < 0.88) {
      return null;
    }

    const leftSection = normalizeTextForMatch(left.sectionTitle);
    const rightSection = normalizeTextForMatch(right.sectionTitle);
    const sectionChanged =
      Boolean(leftSection || rightSection) && leftSection !== rightSection;
    const rightHasUniquePhrase =
      right.debug.lexicalPhraseCoverage > left.debug.lexicalPhraseCoverage;
    const rightHasUniqueStructure =
      right.structuralScore > left.structuralScore + 0.1 &&
      right.debug.structuralSignals.length > 0;

    if (sectionChanged && (rightHasUniquePhrase || rightHasUniqueStructure)) {
      return null;
    }

    if (rightHasUniquePhrase || rightHasUniqueStructure) {
      return null;
    }

    return `near-duplicate of ${left.chunkId}`;
  }

  private async timeStage<T>(fn: () => Promise<T>) {
    const startedAt = Date.now();
    const result = await fn();
    return {
      result,
      durationMs: Date.now() - startedAt,
    };
  }

  private recordStageTiming(stage: string, durationMs: number, kbId: string) {
    this.metrics.recordDuration("retrieval_stage_duration_ms", durationMs, {
      stage,
      kb_id: kbId,
    });
  }
}
