import { NotFoundException } from "@nestjs/common";
import { ChatService } from "./chat.service";

describe("ChatService", () => {
  const createService = () => {
    const prisma = {
      documentChunk: {
        count: jest.fn(),
      },
    } as any;

    const authorization = {
      isAdmin: jest.fn().mockReturnValue(false),
      assertKnowledgeBaseRead: jest.fn(),
    } as any;

    const retrieval = {
      retrieve: jest.fn(),
    } as any;

    const conversations = {
      ensureConversationForAsk: jest.fn(),
      createUserMessage: jest.fn(),
      getPromptHistory: jest.fn(),
      createAssistantMessage: jest.fn(),
      getAccessibleConversation: jest.fn(),
      listConversations: jest.fn(),
      getConversationWithMessages: jest.fn(),
      getConversationMessages: jest.fn(),
    } as any;

    const promptBuilder = {
      build: jest.fn(() => ({ instructions: "test", input: "test" })),
    } as any;

    const openai = {
      isConfigured: true,
      configuredChatModel: "gpt-5",
      maxGroundingChunks: 6,
      createGroundedAnswer: jest.fn(),
    } as any;

    const citations = {
      buildSnippet: jest.fn(
        () => "Reset the worker before retrying the failed job.",
      ),
      assemble: jest.fn(() => ({
        citations: [],
        debug: {
          policyVersion: "answer_level_v1",
          granularity: "answer_level",
          maxCitations: 3,
          requestedChunkIds: [],
          acceptedChunkIds: [],
          rejectedChunkIds: [],
        },
      })),
    } as any;

    const audit = {
      logAction: jest.fn(),
    } as any;

    const metrics = {
      increment: jest.fn(),
      recordDuration: jest.fn(),
    } as any;

    const tracing = {
      startSpan: jest.fn().mockReturnValue({
        setAttribute: jest.fn(),
        recordException: jest.fn(),
        end: jest.fn(),
      }),
    } as any;

    const jsonLogger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as any;

    const localGroundedAnswer = {
      modelName: "local.extractive-grounded-v1",
      createGroundedAnswer: jest.fn(async () => ({
        answer: {
          status: "grounded",
          answer: "Reset the worker before retrying the failed job.",
          usedChunkIds: ["chunk-1"],
        },
        latencyMs: 1,
        model: "local.extractive-grounded-v1",
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          cachedInputTokens: 0,
          reasoningTokens: 0,
        },
      })),
    } as any;

    return {
      prisma,
      authorization,
      retrieval,
      conversations,
      openai,
      citations,
      audit,
      metrics,
      tracing,
      jsonLogger,
      localGroundedAnswer,
      service: new ChatService(
        prisma,
        authorization,
        retrieval,
        conversations,
        promptBuilder,
        openai,
        citations,
        localGroundedAnswer,
        audit,
        metrics,
        tracing,
        jsonLogger,
      ),
    };
  };

  it("returns insufficient_data without calling the model when the KB has no indexed chunks", async () => {
    const { service, prisma, retrieval, conversations, openai, audit } =
      createService();

    prisma.documentChunk.count.mockResolvedValue(0);
    retrieval.retrieve.mockResolvedValue({
      normalizedQuery: "reset worker",
      embeddingsEnabled: false,
      lexicalUsed: false,
      semanticUsed: false,
      totalCandidates: 0,
      selectedChunks: [],
      debug: {
        query: {
          normalizedText: "reset worker",
          lexicalText: "reset worker",
          tokens: ["reset", "worker"],
          phrases: [],
          freshnessIntent: false,
        },
        limits: {
          semanticTopN: 24,
          lexicalTopN: 24,
          rerankPoolLimit: 24,
          groundingTopK: 6,
        },
        weights: {
          semantic: 0.58,
          lexical: 0.22,
          metadata: 0.1,
          recency: 0.03,
          structural: 0.07,
        },
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
    });
    conversations.ensureConversationForAsk.mockResolvedValue({
      id: "conv-1",
      kbId: "kb-1",
    });
    conversations.createUserMessage.mockResolvedValue({ id: "msg-user-1" });
    conversations.createAssistantMessage.mockResolvedValue({
      id: "msg-assistant-1",
    });

    (service as any).resolveKbScope = jest
      .fn()
      .mockResolvedValue({ id: "kb-1" });

    const result = await service.ask(
      { id: "user-1" },
      { kbId: "kb-1", question: "How do I reset the worker?" },
    );

    expect(result.status).toBe("insufficient_data");
    expect(openai.createGroundedAnswer).not.toHaveBeenCalled();
    expect(audit.logAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: "user-1",
        action: "CHAT_ASK",
        entityId: "conv-1",
        entityType: "Conversation",
        kbId: "kb-1",
        metadata: expect.objectContaining({
          assistantMessageId: "msg-assistant-1",
          status: "insufficient_data",
          userMessageId: "msg-user-1",
        }),
      }),
    );
  });

  it("returns out_of_scope when retrieval evidence is too weak", async () => {
    const { service, prisma, retrieval, conversations, openai, audit } =
      createService();

    prisma.documentChunk.count.mockResolvedValue(3);
    retrieval.retrieve.mockResolvedValue({
      normalizedQuery: "vacation policy",
      embeddingsEnabled: false,
      lexicalUsed: true,
      semanticUsed: false,
      totalCandidates: 1,
      selectedChunks: [{ hybridScore: 0.08, kbId: "kb-1" }],
      debug: {
        query: {
          normalizedText: "vacation policy",
          lexicalText: "vacation policy",
          tokens: ["vacation", "policy"],
          phrases: [],
          freshnessIntent: false,
        },
        limits: {
          semanticTopN: 24,
          lexicalTopN: 24,
          rerankPoolLimit: 24,
          groundingTopK: 6,
        },
        weights: {
          semantic: 0.58,
          lexical: 0.22,
          metadata: 0.1,
          recency: 0.03,
          structural: 0.07,
        },
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
    });
    conversations.ensureConversationForAsk.mockResolvedValue({
      id: "conv-1",
      kbId: "kb-1",
    });
    conversations.createUserMessage.mockResolvedValue({ id: "msg-user-1" });
    conversations.createAssistantMessage.mockResolvedValue({
      id: "msg-assistant-1",
    });

    (service as any).resolveKbScope = jest
      .fn()
      .mockResolvedValue({ id: "kb-1" });

    const result = await service.ask(
      { id: "user-1" },
      { kbId: "kb-1", question: "What is our vacation policy?" },
    );

    expect(result.status).toBe("out_of_scope");
    expect(openai.createGroundedAnswer).not.toHaveBeenCalled();
    expect(audit.logAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: "user-1",
        action: "CHAT_ASK",
        entityId: "conv-1",
        entityType: "Conversation",
        kbId: "kb-1",
        metadata: expect.objectContaining({
          assistantMessageId: "msg-assistant-1",
          status: "out_of_scope",
          userMessageId: "msg-user-1",
        }),
      }),
    );
  });

  it("normalizes language filters before counting indexed chunks", async () => {
    const { service, prisma, retrieval, conversations, openai } =
      createService();

    prisma.documentChunk.count.mockResolvedValue(1);
    retrieval.retrieve.mockResolvedValue({
      normalizedQuery: "reset worker",
      embeddingsEnabled: false,
      lexicalUsed: true,
      semanticUsed: false,
      totalCandidates: 1,
      selectedChunks: [
        {
          chunkId: "chunk-1",
          hybridScore: 0.7,
          kbId: "kb-1",
        },
      ],
      debug: {
        query: {
          normalizedText: "reset worker",
          lexicalText: "reset worker",
          tokens: ["reset", "worker"],
          phrases: [],
          freshnessIntent: false,
        },
        limits: {
          semanticTopN: 24,
          lexicalTopN: 24,
          rerankPoolLimit: 24,
          groundingTopK: 6,
        },
        weights: {
          semantic: 0.58,
          lexical: 0.22,
          metadata: 0.1,
          recency: 0.03,
          structural: 0.07,
        },
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
    });
    conversations.ensureConversationForAsk.mockResolvedValue({
      id: "conv-1",
      kbId: "kb-1",
    });
    conversations.createUserMessage.mockResolvedValue({ id: "msg-user-1" });
    conversations.getPromptHistory.mockResolvedValue([]);
    conversations.createAssistantMessage.mockResolvedValue({
      id: "msg-assistant-1",
    });
    openai.createGroundedAnswer.mockResolvedValue({
      answer: {
        status: "grounded",
        answer: "Reset the worker before retrying.",
        usedChunkIds: [],
      },
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
      },
    });

    (service as any).resolveKbScope = jest
      .fn()
      .mockResolvedValue({ id: "kb-1" });

    await service.ask(
      { id: "user-1" },
      {
        kbId: "kb-1",
        question: "How do I reset the worker?",
        filters: { languages: ["EN"] },
      },
    );

    expect(prisma.documentChunk.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          language: { in: ["en"] },
        }),
      }),
    );
  });

  it("downgrades a grounded model answer to insufficient_data when no valid citations remain", async () => {
    const { service, prisma, retrieval, conversations, openai } =
      createService();

    prisma.documentChunk.count.mockResolvedValue(1);
    retrieval.retrieve.mockResolvedValue({
      normalizedQuery: "reset worker",
      embeddingsEnabled: true,
      lexicalUsed: true,
      semanticUsed: true,
      totalCandidates: 2,
      selectedChunks: [
        {
          chunkId: "chunk-1",
          hybridScore: 0.72,
          kbId: "kb-1",
        },
      ],
      debug: {
        query: {
          normalizedText: "reset worker",
          lexicalText: "reset worker",
          tokens: ["reset", "worker"],
          phrases: [],
          freshnessIntent: false,
        },
        limits: {
          semanticTopN: 24,
          lexicalTopN: 24,
          rerankPoolLimit: 24,
          groundingTopK: 6,
        },
        weights: {
          semantic: 0.58,
          lexical: 0.22,
          metadata: 0.1,
          recency: 0.03,
          structural: 0.07,
        },
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
    });
    conversations.ensureConversationForAsk.mockResolvedValue({
      id: "conv-1",
      kbId: "kb-1",
    });
    conversations.createUserMessage.mockResolvedValue({ id: "msg-user-1" });
    conversations.getPromptHistory.mockResolvedValue([]);
    conversations.createAssistantMessage.mockResolvedValue({
      id: "msg-assistant-1",
    });
    openai.createGroundedAnswer.mockResolvedValue({
      answer: {
        status: "grounded",
        answer: "Reset the worker before retrying.",
        usedChunkIds: ["missing-chunk"],
      },
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
      },
    });

    (service as any).resolveKbScope = jest
      .fn()
      .mockResolvedValue({ id: "kb-1" });

    const result = await service.ask(
      { id: "user-1" },
      { kbId: "kb-1", question: "How do I reset the worker?" },
    );

    expect(result.status).toBe("insufficient_data");
    expect(conversations.createAssistantMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "insufficient_data",
        citations: [],
      }),
    );
  });

  it("rejects non-members before retrieval when the KB is outside scope", async () => {
    const { service, authorization, retrieval } = createService();

    authorization.assertKnowledgeBaseRead.mockRejectedValue(
      new NotFoundException("Knowledge base not found"),
    );

    await expect(
      service.ask(
        { id: "user-1" },
        { kbId: "kb-2", question: "How do I reset the worker?" },
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(retrieval.retrieve).not.toHaveBeenCalled();
  });

  it("falls back to the local grounded answer path when OpenAI is unavailable", async () => {
    const {
      service,
      prisma,
      retrieval,
      conversations,
      openai,
      citations,
      localGroundedAnswer,
    } = createService();

    openai.isConfigured = false;
    citations.assemble.mockReturnValue({
      citations: [
        {
          rank: 1,
          score: 0.78,
          chunkId: "chunk-1",
          documentId: "doc-1",
          documentTitle: "Worker Recovery Runbook",
          snippet: "Reset the worker before retrying the failed job.",
          page: null,
          section: "Resetting the worker",
        },
      ],
      debug: {
        policyVersion: "answer_level_v1",
        granularity: "answer_level",
        maxCitations: 3,
        requestedChunkIds: ["chunk-1"],
        acceptedChunkIds: ["chunk-1"],
        rejectedChunkIds: [],
      },
    });
    prisma.documentChunk.count.mockResolvedValue(1);
    retrieval.retrieve.mockResolvedValue({
      normalizedQuery: "reset worker",
      embeddingsEnabled: false,
      lexicalUsed: true,
      semanticUsed: false,
      totalCandidates: 1,
      selectedChunks: [
        {
          chunkId: "chunk-1",
          hybridScore: 0.72,
          kbId: "kb-1",
          content: "Reset the worker before retrying the failed job.",
          searchText: "reset the worker before retrying the failed job",
        },
      ],
      debug: {
        query: {
          normalizedText: "reset worker",
          lexicalText: "reset worker",
          tokens: ["reset", "worker"],
          phrases: [],
          freshnessIntent: false,
        },
        limits: {
          semanticTopN: 24,
          lexicalTopN: 24,
          rerankPoolLimit: 24,
          groundingTopK: 6,
        },
        weights: {
          semantic: 0.58,
          lexical: 0.22,
          metadata: 0.1,
          recency: 0.03,
          structural: 0.07,
        },
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
    });
    conversations.ensureConversationForAsk.mockResolvedValue({
      id: "conv-1",
      kbId: "kb-1",
    });
    conversations.createUserMessage.mockResolvedValue({ id: "msg-user-1" });
    conversations.getPromptHistory.mockResolvedValue([]);
    conversations.createAssistantMessage.mockResolvedValue({
      id: "msg-assistant-1",
    });

    (service as any).resolveKbScope = jest
      .fn()
      .mockResolvedValue({ id: "kb-1" });

    const result = await service.ask(
      { id: "user-1" },
      { kbId: "kb-1", question: "How do I reset the worker?" },
    );

    expect(result.status).toBe("grounded");
    expect(localGroundedAnswer.createGroundedAnswer).toHaveBeenCalledTimes(1);
    expect(openai.createGroundedAnswer).not.toHaveBeenCalled();
  });
});
