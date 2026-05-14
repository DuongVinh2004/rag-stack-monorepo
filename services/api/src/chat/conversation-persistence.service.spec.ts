import {
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConversationPersistenceService } from "./conversation-persistence.service";

describe("ConversationPersistenceService", () => {
  const authorization = {
    isAdmin: jest.fn().mockReturnValue(false),
    buildConversationReadWhere: jest.fn(),
  } as any;

  beforeEach(() => {
    authorization.isAdmin.mockReset();
    authorization.isAdmin.mockReturnValue(false);
    authorization.buildConversationReadWhere.mockReset();
    authorization.buildConversationReadWhere.mockImplementation(
      (user: { id: string }, conversationId?: string) => ({
        ...(conversationId ? { id: conversationId } : {}),
        userId: user.id,
        kb: { members: { some: { userId: user.id } } },
      }),
    );
  });

  it("persists assistant messages and citation snapshots in one transaction", async () => {
    const tx = {
      conversation: {
        findUnique: jest.fn().mockResolvedValue({
          id: "conv-1",
          kbId: "kb-1",
        }),
        update: jest.fn().mockResolvedValue({ id: "conv-1" }),
      },
      documentChunk: {
        findMany: jest.fn().mockResolvedValue([{ id: "chunk-1" }]),
      },
      message: {
        create: jest.fn().mockResolvedValue({
          id: "msg-1",
          createdAt: new Date("2026-04-04T10:00:00Z"),
        }),
      },
      citation: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    const prisma = {
      $transaction: jest.fn(
        async (callback: (innerTx: typeof tx) => Promise<unknown>) =>
          callback(tx),
      ),
    } as any;

    const service = new ConversationPersistenceService(prisma, authorization);

    await service.createAssistantMessage({
      conversationId: "conv-1",
      answer: "Reset the worker before retrying.",
      status: "grounded",
      latencyMs: 42,
      modelName: "gpt-5",
      retrievalMeta: {
        correlationId: null,
        embeddingsEnabled: true,
        filters: {},
        lexicalUsed: true,
        semanticUsed: true,
        totalCandidates: 2,
        selectedChunks: [{ chunkId: "chunk-1", score: 0.8 }],
        normalizedQuery: "reset worker",
        topScore: 0.8,
      },
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
      },
      citations: [
        {
          rank: 1,
          score: 0.81,
          chunkId: "chunk-1",
          documentId: "doc-1",
          documentTitle: "Support Runbook",
          snippet: "Reset the worker before retrying.",
          page: 3,
          section: "Troubleshooting",
        },
      ],
    });

    expect(tx.documentChunk.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["chunk-1"] },
        kbId: "kb-1",
      },
      select: {
        id: true,
      },
    });
    expect(tx.citation.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          messageId: "msg-1",
          chunkId: "chunk-1",
          documentId: "doc-1",
          documentTitle: "Support Runbook",
          rank: 1,
          score: 0.81,
          snippet: "Reset the worker before retrying.",
          pageNumber: 3,
          sectionTitle: "Troubleshooting",
        }),
      ],
    });
    expect(tx.conversation.update).toHaveBeenCalled();
  });

  it("fails persistence when citations reference chunks outside the conversation KB", async () => {
    const tx = {
      conversation: {
        findUnique: jest.fn().mockResolvedValue({
          id: "conv-1",
          kbId: "kb-1",
        }),
        update: jest.fn(),
      },
      documentChunk: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      message: {
        create: jest.fn().mockResolvedValue({
          id: "msg-1",
          createdAt: new Date("2026-04-04T10:00:00Z"),
        }),
      },
      citation: {
        createMany: jest.fn(),
      },
    };

    const prisma = {
      $transaction: jest.fn(
        async (callback: (innerTx: typeof tx) => Promise<unknown>) =>
          callback(tx),
      ),
    } as any;

    const service = new ConversationPersistenceService(prisma, authorization);
    jest
      .spyOn((service as any).logger, "error")
      .mockImplementation(() => undefined);

    await expect(
      service.createAssistantMessage({
        conversationId: "conv-1",
        answer: "Reset the worker before retrying.",
        status: "grounded",
        latencyMs: 42,
        modelName: "gpt-5",
        retrievalMeta: {
          correlationId: null,
          embeddingsEnabled: true,
          filters: {},
          lexicalUsed: true,
          semanticUsed: true,
          totalCandidates: 1,
          selectedChunks: [{ chunkId: "chunk-1", score: 0.8 }],
          normalizedQuery: "reset worker",
          topScore: 0.8,
        },
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
        },
        citations: [
          {
            rank: 1,
            score: 0.8,
            chunkId: "chunk-x",
            documentId: "doc-x",
            documentTitle: "Other KB Runbook",
            snippet: "Unauthorized evidence.",
            page: null,
            section: null,
          },
        ],
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(tx.citation.createMany).not.toHaveBeenCalled();
  });

  it("uses a scoped conversation query and hides other users' conversations", async () => {
    const prisma = {
      conversation: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    } as any;

    const service = new ConversationPersistenceService(prisma, authorization);

    await expect(
      service.getAccessibleConversation({ id: "user-1" }, "conv-2"),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(authorization.buildConversationReadWhere).toHaveBeenCalledWith(
      { id: "user-1" },
      "conv-2",
    );
    expect(prisma.conversation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "conv-2",
          userId: "user-1",
        }),
      }),
    );
  });

  it("fails the request when assistant message persistence fails after generation", async () => {
    const prisma = {
      $transaction: jest.fn().mockRejectedValue(new Error("db failure")),
    } as any;

    const service = new ConversationPersistenceService(prisma, authorization);
    jest
      .spyOn((service as any).logger, "error")
      .mockImplementation(() => undefined);

    await expect(
      service.createAssistantMessage({
        conversationId: "conv-1",
        answer: "Reset the worker before retrying.",
        status: "grounded",
        latencyMs: 42,
        modelName: "gpt-5",
        retrievalMeta: {
          correlationId: null,
          embeddingsEnabled: true,
          filters: {},
          lexicalUsed: true,
          semanticUsed: true,
          totalCandidates: 1,
          selectedChunks: [{ chunkId: "chunk-1", score: 0.8 }],
          normalizedQuery: "reset worker",
          topScore: 0.8,
        },
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
        },
        citations: [],
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
