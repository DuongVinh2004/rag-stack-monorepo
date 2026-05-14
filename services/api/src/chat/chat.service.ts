import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import * as crypto from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuthorizationService } from "../common/authorization/authorization.service";
import {
  CITATION_POLICY_VERSION,
  GROUNDABLE_EVIDENCE_SCORE_THRESHOLD,
  LOW_EVIDENCE_SCORE_THRESHOLD,
  LOW_EVIDENCE_SCORE_THRESHOLD_LEXICAL_ONLY,
  getCitationLimit,
  getPromptHistoryLimit,
} from "./chat.constants";
import { AskQuestionDto } from "./dto/chat.dto";
import { RetrievalService } from "./retrieval.service";
import { ConversationPersistenceService } from "./conversation-persistence.service";
import { PromptBuilderService } from "./prompt-builder.service";
import { OpenAiGatewayService } from "./openai-gateway.service";
import { CitationAssemblerService } from "./citation-assembler.service";
import { LocalGroundedAnswerService } from "./local-grounded-answer.service";
import { AuditService } from "../common/audit/audit.service";
import { JsonLogger } from "../common/observability/json-logger.service";
import { MetricsService } from "../common/observability/metrics.service";
import { TracingService } from "../common/observability/tracing.service";
import { OpenAiGatewayError } from "../openai/openai.types";
import {
  CitationAssemblyResult,
  ChatFilters,
  ChatAuthenticatedUser,
  ChatResponseView,
  EvidenceStrength,
  ChatStatus,
  CitationView,
  RetrievalMetaView,
  RetrievalResult,
  UsageView,
} from "./chat.types";

/** Per-request stage timings for logs (milliseconds). Persist is measured inside persistence. */
export type ChatStageTimings = {
  auth_scope_ms: number;
  conversation_setup_ms: number;
  indexed_chunk_count_ms: number;
  retrieval_wall_ms: number;
  retrieval: {
    embedding_ms: number;
    semantic_fetch_ms: number;
    lexical_fetch_ms: number;
    merge_rerank_ms: number;
    dedup_ms: number;
    total_ms: number;
  };
  history_ms: number;
  prompt_assembly_ms: number;
  model_generation_ms: number;
  citation_assembly_ms: number;
  persist_ms: number;
};

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
    private readonly retrieval: RetrievalService,
    private readonly conversations: ConversationPersistenceService,
    private readonly promptBuilder: PromptBuilderService,
    private readonly openai: OpenAiGatewayService,
    private readonly citations: CitationAssemblerService,
    private readonly localGroundedAnswer: LocalGroundedAnswerService,
    private readonly audit: AuditService,
    private readonly metrics: MetricsService,
    private readonly tracing: TracingService,
    private readonly logger: JsonLogger,
  ) {}

  async ask(
    user: ChatAuthenticatedUser,
    dto: AskQuestionDto,
    correlationId?: string,
  ) {
    const latencyStart = Date.now();
    const span = this.tracing.startSpan("chat.ask", {
      correlationId: correlationId ?? null,
      hasConversationId: Boolean(dto.conversationId),
      hasKbId: Boolean(dto.kbId),
      userId: user.id,
    });

    try {
      let t = Date.now();
      const kb = await this.resolveKbScope(user, dto);
      const auth_scope_ms = Date.now() - t;

      t = Date.now();
      const conversation = await this.conversations.ensureConversationForAsk({
        user,
        kbId: kb.id,
        conversationId: dto.conversationId,
        question: dto.question,
      });
      const userMessage = await this.conversations.createUserMessage({
        conversationId: conversation.id,
        question: dto.question,
      });
      const conversation_setup_ms = Date.now() - t;

      t = Date.now();
      const indexedChunkCount = await this.countIndexedChunks(
        kb.id,
        dto.filters,
      );
      const indexed_chunk_count_ms = Date.now() - t;

      t = Date.now();
      const retrieval = await this.retrieval.retrieve({
        kbId: kb.id,
        userId: user.id,
        isAdmin: this.authorization.isAdmin(user),
        query: dto.question,
        filters: dto.filters,
        groundingLimit: this.openai.maxGroundingChunks,
        correlationId,
      });
      const retrieval_wall_ms = Date.now() - t;
      const retrievalStageTimings = this.mapRetrievalTimingsForLog(
        retrieval.debug.timingsMs,
      );

      this.assertRetrievedChunksStayInKb(retrieval, kb.id, correlationId);
      const topScore = retrieval.selectedChunks[0]?.hybridScore ?? 0;
      const lowEvidenceThreshold =
        this.resolveLowEvidenceThreshold(retrieval);

      const baseStages = (
        extra: Partial<
          Pick<
            ChatStageTimings,
            | "history_ms"
            | "prompt_assembly_ms"
            | "model_generation_ms"
            | "citation_assembly_ms"
          >
        >,
      ): Omit<ChatStageTimings, "persist_ms"> => ({
        auth_scope_ms,
        conversation_setup_ms,
        indexed_chunk_count_ms,
        retrieval_wall_ms,
        retrieval: retrievalStageTimings,
        history_ms: extra.history_ms ?? 0,
        prompt_assembly_ms: extra.prompt_assembly_ms ?? 0,
        model_generation_ms: extra.model_generation_ms ?? 0,
        citation_assembly_ms: extra.citation_assembly_ms ?? 0,
      });

      if (indexedChunkCount === 0) {
        return this.persistSkippedAnswer({
          answer:
            "Tôi chưa có đủ thông tin được lập chỉ mục trong cơ sở kiến thức này để trả lời câu hỏi đó.",
          conversationId: conversation.id,
          correlationId,
          filters: dto.filters,
          kbId: kb.id,
          latencyStart,
          question: dto.question,
          retrieval,
          span,
          stageTimingsBase: baseStages({}),
          status: "insufficient_data",
          topScore,
          user,
          userMessageId: userMessage.id,
        });
      }

      if (
        !retrieval.selectedChunks.length ||
        topScore < lowEvidenceThreshold
      ) {
        return this.persistSkippedAnswer({
          answer:
            "Tôi không tìm thấy tài liệu hỗ trợ phù hợp nào trong cơ sở kiến thức đã chọn cho câu hỏi đó.",
          conversationId: conversation.id,
          correlationId,
          filters: dto.filters,
          kbId: kb.id,
          latencyStart,
          question: dto.question,
          retrieval,
          span,
          stageTimingsBase: baseStages({}),
          status: "out_of_scope",
          topScore,
          user,
          userMessageId: userMessage.id,
        });
      }

      t = Date.now();
      const history = await this.conversations.getPromptHistory(
        conversation.id,
        getPromptHistoryLimit(),
      );
      const history_ms = Date.now() - t;

      t = Date.now();
      const prompt = this.promptBuilder.build({
        question: dto.question,
        evidenceStrength: this.resolveEvidenceStrength(topScore),
        conversationHistory: history.filter(
          (message) => message.role !== "SYSTEM",
        ),
        selectedChunks: retrieval.selectedChunks,
      });
      const prompt_assembly_ms = Date.now() - t;

      const modelResult = await this.createGroundedAnswerOrThrow(
        dto.question,
        retrieval.normalizedQuery,
        retrieval.selectedChunks,
        prompt,
        kb.id,
        correlationId,
      );
      const model_generation_ms = modelResult.latencyMs;

      t = Date.now();
      const citationAssembly =
        modelResult.answer.status === "grounded"
          ? this.assembleCitations({
              answerText: modelResult.answer.answer,
              conversationId: conversation.id,
              retrieval,
              usedChunkIds: modelResult.answer.usedChunkIds,
            })
          : this.emptyCitationAssembly();
      const citation_assembly_ms = Date.now() - t;

      const finalizedAnswer = this.finalizeAnswer(
        modelResult.answer.status,
        modelResult.answer.answer,
        citationAssembly.citations.length,
      );

      return this.persistAnswerOutcome({
        answer: finalizedAnswer.answer,
        citations: citationAssembly.citations,
        conversationId: conversation.id,
        correlationId,
        event: "chat_answer_generated",
        filters: dto.filters,
        kbId: kb.id,
        latencyStart,
        question: dto.question,
        retrieval,
        span,
        stageTimingsBase: baseStages({
          history_ms,
          prompt_assembly_ms,
          model_generation_ms,
          citation_assembly_ms,
        }),
        status: finalizedAnswer.status,
        topScore,
        usage: modelResult.usage,
        user,
        userMessageId: userMessage.id,
      });
    } catch (error) {
      span.recordException(error);
      span.end({ status: "failed" });
      throw error;
    }
  }

  async listConversations(user: ChatAuthenticatedUser, kbId?: string) {
    if (kbId) {
      await this.resolveKbScope(user, {
        kbId,
        question: "list conversations",
      } as AskQuestionDto);
    }
    return this.conversations.listConversations(user, kbId);
  }

  async getConversation(user: ChatAuthenticatedUser, conversationId: string) {
    return this.conversations.getConversationWithMessages(user, conversationId);
  }

  async getConversationMessages(
    user: ChatAuthenticatedUser,
    conversationId: string,
    limit?: number,
  ) {
    return this.conversations.getConversationMessages(
      user,
      conversationId,
      limit,
    );
  }

  private async resolveKbScope(
    user: ChatAuthenticatedUser,
    dto: AskQuestionDto,
  ) {
    if (dto.kbId) {
      return this.authorization.assertKnowledgeBaseRead(user, dto.kbId);
    }

    if (!dto.conversationId) {
      throw new BadRequestException("kbId or conversationId is required");
    }

    const conversation = await this.conversations.getAccessibleConversation(
      user,
      dto.conversationId,
    );

    return this.authorization.assertKnowledgeBaseRead(user, conversation.kbId);
  }

  private async countIndexedChunks(kbId: string, filters?: ChatFilters) {
    return this.prisma.documentChunk.count({
      where: {
        kbId,
        supersededAt: null,
        document: { status: "INDEXED" },
        documentVersion: { status: "INDEXED" },
        ...(filters?.documentIds?.length
          ? { documentId: { in: filters.documentIds } }
          : {}),
        ...(filters?.languages?.length
          ? {
              language: {
                in: filters.languages.map((language) => language.toLowerCase()),
              },
            }
          : {}),
      },
    });
  }

  private resolveEvidenceStrength(topScore: number): EvidenceStrength {
    if (topScore >= 0.6) {
      return "high";
    }
    if (topScore >= GROUNDABLE_EVIDENCE_SCORE_THRESHOLD) {
      return "medium";
    }
    return "low";
  }

  private resolveLowEvidenceThreshold(retrieval: RetrievalResult) {
    if (!retrieval.semanticUsed && retrieval.lexicalUsed) {
      return LOW_EVIDENCE_SCORE_THRESHOLD_LEXICAL_ONLY;
    }

    return LOW_EVIDENCE_SCORE_THRESHOLD;
  }

  private async createGroundedAnswerOrThrow(
    question: string,
    normalizedQuery: string,
    selectedChunks: RetrievalResult["selectedChunks"],
    prompt: { instructions: string; input: string },
    kbId: string,
    correlationId?: string,
  ) {
    if (!this.openai.isConfigured) {
      return this.localGroundedAnswer.createGroundedAnswer({
        question,
        normalizedQuery,
        selectedChunks,
      });
    }

    try {
      return await this.openai.createGroundedAnswer(prompt, {
        correlationId,
        kbId,
        requestType: "grounded_chat",
        batchSize: selectedChunks.length,
      });
    } catch (error) {
      if (error instanceof OpenAiGatewayError) {
        this.logger.error(
          {
            correlation_id: correlationId ?? null,
            error_code: error.code,
            event: "chat_answer_generation_failed",
            kb_id: kbId,
            request_id: correlationId ?? null,
            request_type: error.requestType,
            retryable: error.retryable,
          },
          undefined,
          ChatService.name,
        );
        throw new ServiceUnavailableException("Answer generation failed");
      }

      throw error;
    }
  }

  private assembleCitations(params: {
    conversationId: string;
    usedChunkIds: string[];
    retrieval: RetrievalResult;
    answerText: string;
  }): CitationAssemblyResult {
    try {
      const assembled = this.citations.assemble({
        usedChunkIds: params.usedChunkIds,
        selectedChunks: params.retrieval.selectedChunks,
        normalizedQuery: params.retrieval.normalizedQuery,
        answerText: params.answerText,
      });
      const rejectedOutsideGrounding = assembled.debug.rejectedChunkIds.filter(
        (entry) => entry.reason === "not_in_grounding_set",
      );
      if (rejectedOutsideGrounding.length) {
        this.logger.warn(
          {
            conversation_id: params.conversationId,
            event: "citation_chunk_ids_rejected",
            rejected_chunk_ids: rejectedOutsideGrounding.map(
              (entry) => entry.chunkId,
            ),
          },
          ChatService.name,
        );
      }

      return assembled;
    } catch (error) {
      this.logger.error(
        {
          conversation_id: params.conversationId,
          event: "citation_assembly_failed",
        },
        error instanceof Error ? error.stack : undefined,
        ChatService.name,
      );
      throw new ServiceUnavailableException("Citation assembly failed");
    }
  }

  private finalizeAnswer(
    status: ChatStatus,
    answer: string,
    citationCount: number,
  ) {
    if (status === "grounded" && citationCount === 0) {
      return {
        status: "insufficient_data" as const,
        answer:
          "I could not assemble a citation-backed answer from the available sources.",
      };
    }

    return { status, answer };
  }

  private buildRetrievalMeta(
    retrieval: RetrievalResult,
    filters: ChatFilters | undefined,
    topScore: number,
    correlationId?: string,
  ): RetrievalMetaView {
    return {
      correlationId: correlationId ?? null,
      embeddingsEnabled: retrieval.embeddingsEnabled,
      filters: filters ?? {},
      lexicalUsed: retrieval.lexicalUsed,
      semanticUsed: retrieval.semanticUsed,
      totalCandidates: retrieval.totalCandidates,
      selectedChunks: retrieval.selectedChunks.map((chunk) => ({
        chunkId: chunk.chunkId,
        score: Number(chunk.hybridScore.toFixed(6)),
      })),
      normalizedQuery: retrieval.normalizedQuery,
      topScore: Number(topScore.toFixed(6)),
    };
  }

  private emptyUsage(): UsageView {
    return {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    };
  }

  private resolvePersistedModelName(usage: UsageView) {
    if (usage.totalTokens > 0) {
      return this.openai.configuredChatModel;
    }

    return this.openai.isConfigured
      ? this.openai.configuredChatModel
      : this.localGroundedAnswer.modelName;
  }

  private emptyCitationAssembly(): CitationAssemblyResult {
    return {
      citations: [],
      debug: {
        policyVersion: CITATION_POLICY_VERSION,
        granularity: "answer_level",
        maxCitations: getCitationLimit(),
        requestedChunkIds: [],
        acceptedChunkIds: [],
        rejectedChunkIds: [],
      },
    };
  }

  private async persistSkippedAnswer(params: {
    conversationId: string;
    question: string;
    answer: string;
    status: "insufficient_data" | "out_of_scope";
    filters?: AskQuestionDto["filters"];
    kbId: string;
    latencyStart: number;
    retrieval: RetrievalResult;
    span: ReturnType<TracingService["startSpan"]>;
    stageTimingsBase: Omit<ChatStageTimings, "persist_ms">;
    topScore: number;
    correlationId?: string;
    user: ChatAuthenticatedUser;
    userMessageId: string;
  }) {
    return this.persistAnswerOutcome({
      ...params,
      citations: [],
      event: "chat_answer_skipped_generation",
      usage: this.emptyUsage(),
    });
  }

  private async persistAnswerOutcome(params: {
    conversationId: string;
    question: string;
    answer: string;
    status: ChatStatus;
    citations: CitationView[];
    filters?: AskQuestionDto["filters"];
    kbId: string;
    latencyStart: number;
    retrieval: RetrievalResult;
    span: ReturnType<TracingService["startSpan"]>;
    stageTimingsBase: Omit<ChatStageTimings, "persist_ms">;
    topScore: number;
    correlationId?: string;
    user: ChatAuthenticatedUser;
    userMessageId: string;
    usage: UsageView;
    event: "chat_answer_generated" | "chat_answer_skipped_generation";
  }): Promise<ChatResponseView> {
    const latencyMs = Date.now() - params.latencyStart;
    const roundedTopScore = Number(params.topScore.toFixed(6));

    const persistStarted = Date.now();
    const assistantMessage = await this.conversations.createAssistantMessage({
      conversationId: params.conversationId,
      answer: params.answer,
      citations: params.citations,
      latencyMs,
      modelName: this.resolvePersistedModelName(params.usage),
      retrievalMeta: this.buildRetrievalMeta(
        params.retrieval,
        params.filters,
        params.topScore,
        params.correlationId,
      ),
      status: params.status,
      usage: params.usage,
    });

    await this.audit.logAction({
      actorId: params.user.id,
      action: "CHAT_ASK",
      entityType: "Conversation",
      entityId: params.conversationId,
      kbId: params.kbId,
      metadata: {
        assistantMessageId: assistantMessage.id,
        citationCount: params.citations.length,
        correlationId: params.correlationId,
        questionHash: this.hashForAudit(params.question),
        questionLength: params.question.length,
        status: params.status,
        topScore: params.topScore,
        userMessageId: params.userMessageId,
      },
    });

    const persist_ms = Date.now() - persistStarted;
    const stage_timings_ms: ChatStageTimings = {
      ...params.stageTimingsBase,
      persist_ms,
    };

    this.recordOutcomeMetrics(params.status, params.kbId, latencyMs);
    this.logChatOutcome({
      assistant_message_id: assistantMessage.id,
      citation_count: params.citations.length,
      conversation_id: params.conversationId,
      correlation_id: params.correlationId ?? null,
      event: params.event,
      kb_id: params.kbId,
      latency_ms: latencyMs,
      request_id: params.correlationId ?? null,
      stage_timings_ms,
      status: params.status,
      top_score: roundedTopScore,
      user_id: params.user.id,
      user_message_id: params.userMessageId,
    });
    params.span.end({
      citationCount: params.citations.length,
      latencyMs,
      status: params.status,
      topScore: roundedTopScore,
    });

    return {
      conversationId: params.conversationId,
      messageId: assistantMessage.id,
      answer: params.answer,
      citations: params.citations,
      usage: params.usage,
      latencyMs,
      status: params.status,
    };
  }

  private hashForAudit(value: string) {
    return crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
  }

  private recordOutcomeMetrics(
    status: ChatStatus,
    kbId: string,
    latencyMs: number,
  ) {
    this.metrics.increment("chat_requests_total", 1, {
      status,
      kb_id: kbId,
    });
    this.metrics.recordDuration("chat_request_duration_ms", latencyMs, {
      status,
      kb_id: kbId,
    });
  }

  private logChatOutcome(params: {
    assistant_message_id: string;
    citation_count: number;
    conversation_id: string;
    correlation_id: string | null;
    event: "chat_answer_generated" | "chat_answer_skipped_generation";
    kb_id: string;
    latency_ms: number;
    request_id: string | null;
    stage_timings_ms: ChatStageTimings;
    status: ChatStatus;
    top_score: number;
    user_id: string;
    user_message_id: string;
  }) {
    this.logger.log(
      {
        assistant_message_id: params.assistant_message_id,
        citation_count: params.citation_count,
        conversation_id: params.conversation_id,
        correlation_id: params.correlation_id,
        event: params.event,
        kb_id: params.kb_id,
        latency_ms: params.latency_ms,
        request_id: params.request_id,
        stage_timings_ms: params.stage_timings_ms,
        status: params.status,
        top_score: params.top_score,
        user_id: params.user_id,
        user_message_id: params.user_message_id,
      },
      ChatService.name,
    );
  }

  private mapRetrievalTimingsForLog(timings: RetrievalResult["debug"]["timingsMs"]) {
    return {
      embedding_ms: timings.embeddingMs,
      semantic_fetch_ms: timings.semanticFetchMs,
      lexical_fetch_ms: timings.lexicalFetchMs,
      merge_rerank_ms: timings.mergeRerankMs,
      dedup_ms: timings.dedupMs,
      total_ms: timings.totalMs,
    };
  }

  private assertRetrievedChunksStayInKb(
    retrieval: RetrievalResult,
    kbId: string,
    correlationId?: string,
  ) {
    const invalidChunk = retrieval.selectedChunks.find(
      (chunk) => chunk.kbId !== kbId,
    );
    if (!invalidChunk) {
      return;
    }

    this.logger.error(
      {
        correlation_id: correlationId ?? null,
        event: "retrieval_kb_integrity_violation",
        expected_kb_id: kbId,
        invalid_chunk_id: invalidChunk.chunkId,
        invalid_chunk_kb_id: invalidChunk.kbId,
        request_id: correlationId ?? null,
      },
      undefined,
      ChatService.name,
    );
    throw new ServiceUnavailableException("Retrieval integrity check failed");
  }
}
