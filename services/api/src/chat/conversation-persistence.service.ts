import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  ConversationStatus,
  MessageRole,
  Prisma,
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuthorizationService } from "../common/authorization/authorization.service";
import {
  ChatAuthenticatedUser,
  CitationView,
  RetrievalMetaView,
  UsageView,
} from "./chat.types";
import { getConversationMessageLimit } from "./chat.constants";

@Injectable()
export class ConversationPersistenceService {
  private readonly logger = new Logger(ConversationPersistenceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
  ) {}

  isAdmin(user: ChatAuthenticatedUser) {
    return this.authorization.isAdmin(user);
  }

  async getAccessibleConversation(
    user: ChatAuthenticatedUser,
    conversationId: string,
  ) {
    const conversation = await this.prisma.conversation.findFirst({
      where: this.authorization.buildConversationReadWhere(user, conversationId),
      include: {
        kb: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!conversation) {
      throw new NotFoundException("Conversation not found");
    }

    return conversation;
  }

  async listConversations(user: ChatAuthenticatedUser, kbId?: string) {
    return this.prisma.conversation.findMany({
      where: {
        ...this.authorization.buildConversationReadWhere(user),
        ...(kbId ? { kbId } : {}),
      },
      include: {
        kb: {
          select: {
            id: true,
            name: true,
          },
        },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            role: true,
            content: true,
            createdAt: true,
          },
        },
      },
      orderBy: { lastActivityAt: "desc" },
    });
  }

  async getConversationWithMessages(
    user: ChatAuthenticatedUser,
    conversationId: string,
    limit = getConversationMessageLimit(),
  ) {
    const conversation = await this.getAccessibleConversation(
      user,
      conversationId,
    );
    const messages = await this.loadConversationMessages(
      conversation.id,
      limit,
    );

    return {
      ...conversation,
      messages: messages.map((message) => this.toMessageView(message)),
    };
  }

  async getConversationMessages(
    user: ChatAuthenticatedUser,
    conversationId: string,
    limit = getConversationMessageLimit(),
  ) {
    const conversation = await this.getAccessibleConversation(
      user,
      conversationId,
    );
    const messages = await this.loadConversationMessages(
      conversation.id,
      limit,
    );

    return messages.map((message) => this.toMessageView(message));
  }

  async ensureConversationForAsk(params: {
    user: ChatAuthenticatedUser;
    kbId: string;
    conversationId?: string;
    question: string;
  }) {
    if (params.conversationId) {
      const conversation = await this.getAccessibleConversation(
        params.user,
        params.conversationId,
      );
      if (conversation.kbId !== params.kbId) {
        throw new BadRequestException(
          "Conversation KB scope does not match request KB",
        );
      }
      return conversation;
    }

    try {
      return await this.prisma.conversation.create({
        data: {
          userId: params.user.id,
          kbId: params.kbId,
          title: this.buildConversationTitle(params.question),
          status: ConversationStatus.ACTIVE,
          lastActivityAt: new Date(),
        },
      });
    } catch (error) {
      this.handlePersistenceFailure("Failed to create conversation", error, {
        event: "conversation_create_failed",
        kb_id: params.kbId,
        user_id: params.user.id,
      });
    }
  }

  async createUserMessage(params: {
    conversationId: string;
    question: string;
  }) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const message = await tx.message.create({
          data: {
            conversationId: params.conversationId,
            role: MessageRole.USER,
            content: params.question,
          },
        });

        await tx.conversation.update({
          where: { id: params.conversationId },
          data: {
            lastActivityAt: message.createdAt,
          },
        });

        return message;
      });
    } catch (error) {
      this.handlePersistenceFailure("Failed to persist user message", error, {
        conversation_id: params.conversationId,
        event: "conversation_user_message_persist_failed",
      });
    }
  }

  async createAssistantMessage(params: {
    conversationId: string;
    answer: string;
    status: string;
    citations: CitationView[];
    usage: UsageView;
    latencyMs: number;
    modelName: string;
    retrievalMeta: RetrievalMetaView;
  }) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const conversation = await tx.conversation.findUnique({
          where: { id: params.conversationId },
          select: {
            id: true,
            kbId: true,
          },
        });

        if (!conversation) {
          throw new Error("Conversation not found during assistant message persistence");
        }

        const message = await tx.message.create({
          data: {
            conversationId: params.conversationId,
            role: MessageRole.ASSISTANT,
            content: params.answer,
            latencyMs: params.latencyMs,
            usageJson: params.usage as unknown as Prisma.InputJsonValue,
            retrievalMetaJson: {
              status: params.status,
              ...params.retrievalMeta,
            } as unknown as Prisma.InputJsonValue,
            modelName: params.modelName,
          },
        });

        if (params.citations.length) {
          const citationChunkIds = Array.from(
            new Set(params.citations.map((citation) => citation.chunkId)),
          );
          const scopedChunks = await tx.documentChunk.findMany({
            where: {
              id: { in: citationChunkIds },
              kbId: conversation.kbId,
            },
            select: {
              id: true,
            },
          });

          if (scopedChunks.length !== citationChunkIds.length) {
            throw new Error("Citation scope validation failed");
          }

          await tx.citation.createMany({
            data: params.citations.map((citation) => ({
              messageId: message.id,
              chunkId: citation.chunkId,
              documentId: citation.documentId,
              documentTitle: citation.documentTitle,
              rank: citation.rank,
              score: citation.score,
              snippet: citation.snippet,
              pageNumber: citation.page,
              sectionTitle: citation.section,
            })),
          });
        }

        await tx.conversation.update({
          where: { id: params.conversationId },
          data: {
            lastActivityAt: new Date(),
          },
        });

        return message;
      });
    } catch (error) {
      this.handlePersistenceFailure(
        "Failed to persist assistant message",
        error,
        {
          conversation_id: params.conversationId,
          event: "conversation_assistant_message_persist_failed",
        },
      );
    }
  }

  async getPromptHistory(conversationId: string, limit: number) {
    const messages = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
      take: Math.max(0, limit),
    });

    return messages.reverse().map((message) => ({
      role: message.role,
      content: message.content,
    }));
  }

  private buildConversationTitle(question: string) {
    const trimmed = question.replace(/\s+/g, " ").trim();
    return trimmed.length > 80 ? `${trimmed.slice(0, 77)}...` : trimmed;
  }

  private handlePersistenceFailure(
    message: string,
    error: unknown,
    extra?: Record<string, unknown>,
  ): never {
    this.logger.error(
      {
        event: extra?.event ?? "conversation_persistence_failed",
        message,
        ...extra,
      },
      error instanceof Error ? error.stack : undefined,
    );
    throw new ServiceUnavailableException("Conversation persistence failed");
  }

  private async loadConversationMessages(
    conversationId: string,
    limit: number,
  ) {
    const messages = await this.prisma.message.findMany({
      where: { conversationId },
      include: {
        citations: {
          orderBy: { rank: "asc" },
        },
      },
      orderBy: { createdAt: "desc" },
      take: Math.max(1, Math.min(limit, 100)),
    });

    return messages.reverse();
  }

  private toMessageView(
    message: Prisma.MessageGetPayload<{
      include: {
        citations: true;
      };
    }>,
  ) {
    return {
      id: message.id,
      role: message.role,
      content: message.content,
      latencyMs: message.latencyMs,
      usage: message.usageJson,
      retrievalMeta: message.retrievalMetaJson,
      modelName: message.modelName,
      createdAt: message.createdAt,
      citations: message.citations.map((citation) => ({
        rank: citation.rank,
        score: citation.score,
        chunkId: citation.chunkId,
        documentId: citation.documentId,
        documentTitle: citation.documentTitle,
        snippet: citation.snippet,
        page: citation.pageNumber,
        section: citation.sectionTitle,
      })),
    };
  }
}
