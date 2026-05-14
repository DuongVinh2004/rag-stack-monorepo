import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { ChatController } from '../src/chat/chat.controller';
import { ChatService } from '../src/chat/chat.service';
import { RetrievalService } from '../src/chat/retrieval.service';
import { QueryNormalizerService } from '../src/chat/query-normalizer.service';
import { HybridScorerService } from '../src/chat/hybrid-scorer.service';
import { CitationAssemblerService } from '../src/chat/citation-assembler.service';
import { LocalGroundedAnswerService } from '../src/chat/local-grounded-answer.service';
import { PromptBuilderService } from '../src/chat/prompt-builder.service';
import { ConversationPersistenceService } from '../src/chat/conversation-persistence.service';
import { RetrievalQueryRepository } from '../src/chat/retrieval-query.repository';
import { KnowledgeBasesService } from '../src/knowledge-bases/knowledge-bases.service';
import { AuditService } from '../src/common/audit/audit.service';
import { JsonLogger } from '../src/common/observability/json-logger.service';
import { MetricsService } from '../src/common/observability/metrics.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { TracingService } from '../src/common/observability/tracing.service';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';
import { OpenAiGatewayService } from '../src/chat/openai-gateway.service';
import { AuthorizationService } from '../src/common/authorization/authorization.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_USER_ID = '33333333-3333-4333-8333-333333333333';
const PRIVATE_KB_ID = '22222222-2222-4222-8222-222222222222';
const FORBIDDEN_KB_ID = '44444444-4444-4444-8444-444444444444';

type ChatChunkRecord = {
  chunkId: string;
  kbId: string;
  documentId: string;
  documentTitle: string;
  documentVersionId: string;
  chunkNo: number;
  content: string;
  searchText: string;
  checksum: string;
  sectionTitle: string | null;
  pageNumber: number | null;
  sourceTitle: string | null;
  language: string | null;
  metadataJson: Record<string, unknown> | null;
  indexedAt: Date;
};

type ConversationRecord = {
  id: string;
  userId: string;
  kbId: string;
  title: string | null;
  status: 'ACTIVE' | 'ARCHIVED';
  lastActivityAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

type MessageRecord = {
  id: string;
  conversationId: string;
  role: 'USER' | 'ASSISTANT' | 'SYSTEM';
  content: string;
  latencyMs: number | null;
  usageJson: Record<string, unknown> | null;
  retrievalMetaJson: Record<string, unknown> | null;
  modelName: string | null;
  createdAt: Date;
};

type CitationRecord = {
  id: string;
  messageId: string;
  chunkId: string;
  documentId: string;
  documentTitle: string;
  rank: number;
  score: number;
  snippet: string;
  pageNumber: number | null;
  sectionTitle: string | null;
  createdAt: Date;
};

class AllowAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    req.user = { id: USER_ID, UserRole: [] };
    return true;
  }
}

class FakeOpenAiGatewayService {
  isConfigured = true;
  configuredChatModel = 'gpt-5';
  configuredEmbeddingModel = 'text-embedding-3-small';
  embeddingsEnabled = true;
  maxGroundingChunks = 6;

  async createQueryEmbedding(query: string) {
    const normalizedQuery = query.toLowerCase();
    let embedding: number[] | null = null;

    if (normalizedQuery.includes('reset') && normalizedQuery.includes('worker')) {
      embedding = [1, 0];
    } else if (normalizedQuery.includes('collect') && normalizedQuery.includes('escalat')) {
      embedding = [1, 1];
    } else if (normalizedQuery.includes('vacation policy')) {
      embedding = null;
    }

    if (!embedding) {
      return {
        status: 'disabled' as const,
        reason: 'feature_disabled' as const,
        model: this.configuredEmbeddingModel,
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          cachedInputTokens: 0,
          reasoningTokens: 0,
        },
        latencyMs: 0,
        dimensions: null,
        embedding: null,
        errorCode: null,
      };
    }

    return {
      status: 'success' as const,
      model: this.configuredEmbeddingModel,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cachedInputTokens: 0,
        reasoningTokens: 0,
      },
      latencyMs: 0,
      dimensions: embedding.length,
      embedding,
      errorCode: null,
    };
  }

  async createGroundedAnswer(params: { input: string }) {
    const question =
      params.input.match(/Question:\s*(.+)$/m)?.[1]?.trim() ?? params.input;

    if (question.includes('What should I collect before escalating?')) {
      return {
        answer: {
          status: 'grounded' as const,
          answer:
            'Collect the request id before retrying and include it when escalating after repeated failures.',
          usedChunkIds: [
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          ],
        },
        usage: {
          inputTokens: 160,
          outputTokens: 38,
          totalTokens: 198,
        },
      };
    }

    if (question.includes('How do I reset the worker?')) {
      return {
        answer: {
          status: 'grounded' as const,
          answer: 'Reset the worker before retrying the failed job.',
          usedChunkIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
        },
        usage: {
          inputTokens: 120,
          outputTokens: 24,
          totalTokens: 144,
        },
      };
    }

    return {
      answer: {
        status: 'out_of_scope' as const,
        answer: 'The selected knowledge base does not contain enough evidence for that question.',
        usedChunkIds: [],
      },
      usage: {
        inputTokens: 100,
        outputTokens: 16,
        totalTokens: 116,
      },
    };
  }
}

class FakePrismaService {
  knowledgeBases = [
    {
      id: PRIVATE_KB_ID,
      name: 'Operations KB',
      visibility: 'PRIVATE',
      members: [{ kbId: PRIVATE_KB_ID, userId: USER_ID, role: 'OWNER' }],
    },
    {
      id: FORBIDDEN_KB_ID,
      name: 'Secret KB',
      visibility: 'PRIVATE',
      members: [{ kbId: FORBIDDEN_KB_ID, userId: OTHER_USER_ID, role: 'OWNER' }],
    },
  ];

  chunks: ChatChunkRecord[] = [
    {
      chunkId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      kbId: PRIVATE_KB_ID,
      documentId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      documentTitle: 'Worker Runbook',
      documentVersionId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      chunkNo: 1,
      content: 'Reset the worker before retrying the failed job. Capture the request id first.',
      searchText: 'reset the worker before retrying the failed job capture the request id first',
      checksum: 'checksum-1',
      sectionTitle: 'Troubleshooting',
      pageNumber: 3,
      sourceTitle: 'Worker Runbook',
      language: 'en',
      metadataJson: null,
      indexedAt: new Date('2026-04-02T00:00:00Z'),
    },
    {
      chunkId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      kbId: PRIVATE_KB_ID,
      documentId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      documentTitle: 'Escalation Guide',
      documentVersionId: '99999999-9999-4999-8999-999999999999',
      chunkNo: 1,
      content: 'Escalate after two failed retries and include the request id in the incident.',
      searchText: 'escalate after two failed retries and include the request id in the incident',
      checksum: 'checksum-2',
      sectionTitle: 'Escalation',
      pageNumber: 1,
      sourceTitle: 'Escalation Guide',
      language: 'en',
      metadataJson: null,
      indexedAt: new Date('2026-04-01T00:00:00Z'),
    },
  ];

  conversations: ConversationRecord[] = [];
  messages: MessageRecord[] = [];
  citations: CitationRecord[] = [];
  audits: any[] = [];
  sequence = 1;
  timestampSequence = 0;

  knowledgeBase = {
    findUnique: jest.fn(async ({ where, include }: any) => {
      const kb = this.knowledgeBases.find((item) => item.id === where.id);
      if (!kb) {
        return null;
      }
      return {
        ...kb,
        ...(include?.members
          ? {
              members: kb.members
                .filter((member) =>
                  include.members.where?.userId ? member.userId === include.members.where.userId : true,
                )
                .map((member) => ({ ...member })),
            }
          : {}),
        ...(include?._count
          ? {
              _count: {
                members: kb.members.length,
                documents: this.chunks.filter((chunk) => chunk.kbId === kb.id).length,
              },
            }
          : {}),
      };
    }),
  };

  conversation = {
    findFirst: jest.fn(async ({ where, include }: any) => {
      const conversation = this.findMatchingConversations(where)[0];
      return conversation ? this.mapConversation(conversation, include) : null;
    }),
    findUnique: jest.fn(async ({ where, include }: any) => {
      const conversation = this.conversations.find((item) => item.id === where.id);
      if (!conversation) {
        return null;
      }
      return this.mapConversation(conversation, include);
    }),
    findMany: jest.fn(async ({ where, include }: any) => {
      return this.findMatchingConversations(where)
        .sort((left, right) => right.lastActivityAt.getTime() - left.lastActivityAt.getTime())
        .map((conversation) => this.mapConversation(conversation, include));
    }),
    create: jest.fn(async ({ data }: any) => {
      const now = this.nextTimestamp();
      const record: ConversationRecord = {
        id: this.nextId(),
        userId: data.userId,
        kbId: data.kbId,
        title: data.title ?? null,
        status: data.status,
        lastActivityAt: data.lastActivityAt ?? now,
        createdAt: now,
        updatedAt: now,
      };
      this.conversations.push(record);
      return { ...record };
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const record = this.conversations.find((item) => item.id === where.id);
      if (!record) {
        throw new Error('conversation not found');
      }
      Object.assign(record, data, { updatedAt: this.nextTimestamp() });
      return { ...record };
    }),
  };

  message = {
    create: jest.fn(async ({ data }: any) => {
      const record: MessageRecord = {
        id: this.nextId(),
        conversationId: data.conversationId,
        role: data.role,
        content: data.content,
        latencyMs: data.latencyMs ?? null,
        usageJson: data.usageJson ?? null,
        retrievalMetaJson: data.retrievalMetaJson ?? null,
        modelName: data.modelName ?? null,
        createdAt: this.nextTimestamp(),
      };
      this.messages.push(record);
      return { ...record };
    }),
    findMany: jest.fn(async ({ where, include, orderBy, take }: any) => {
      const filtered = this.messages
        .filter((message) => message.conversationId === where.conversationId)
        .sort((left, right) =>
          orderBy?.createdAt === 'desc'
            ? right.createdAt.getTime() - left.createdAt.getTime()
            : left.createdAt.getTime() - right.createdAt.getTime(),
        )
        .slice(0, take ?? undefined);

      return filtered.map((message) =>
        include?.citations
          ? {
              ...message,
              citations: this.citations
                .filter((citation) => citation.messageId === message.id)
                .sort((left, right) => left.rank - right.rank)
                .map((citation) => ({
                  ...citation,
                  chunk: {
                    ...this.chunks.find((chunk) => chunk.chunkId === citation.chunkId)!,
                    document: {
                      id: this.chunks.find((chunk) => chunk.chunkId === citation.chunkId)!.documentId,
                      name: this.chunks.find((chunk) => chunk.chunkId === citation.chunkId)!.documentTitle,
                    },
                  },
                })),
            }
          : { ...message },
      );
    }),
  };

  citation = {
    createMany: jest.fn(async ({ data }: any) => {
      data.forEach((row: any) => {
        this.citations.push({
          id: this.nextId(),
          messageId: row.messageId,
          chunkId: row.chunkId,
          documentId: row.documentId,
          documentTitle: row.documentTitle,
          rank: row.rank,
          score: row.score,
          snippet: row.snippet,
          pageNumber: row.pageNumber ?? null,
          sectionTitle: row.sectionTitle ?? null,
          createdAt: this.nextTimestamp(),
        });
      });
      return { count: data.length };
    }),
  };

  documentChunk = {
    count: jest.fn(async ({ where }: any) => {
      return this.chunks.filter((chunk) => {
        if (chunk.kbId !== where.kbId) {
          return false;
        }
        if (where.documentId?.in && !where.documentId.in.includes(chunk.documentId)) {
          return false;
        }
        if (where.language?.in && !where.language.in.includes(chunk.language)) {
          return false;
        }
        return true;
      }).length;
    }),
    findMany: jest.fn(async ({ where }: any) => {
      return this.chunks
        .filter((chunk) => {
          if (where?.kbId && chunk.kbId !== where.kbId) {
            return false;
          }
          if (where?.id?.in && !where.id.in.includes(chunk.chunkId)) {
            return false;
          }
          return true;
        })
        .map((chunk) => ({
          id: chunk.chunkId,
        }));
    }),
  };

  auditLog = {
    create: jest.fn(async ({ data }: any) => {
      this.audits.push(data);
      return data;
    }),
  };

  $transaction = jest.fn(async (callback: any) => callback(this));

  $queryRaw = jest.fn(async (query: any) => {
    const sqlText = Array.isArray(query?.strings) ? query.strings.join(' ') : String(query ?? '');
    const values = Array.isArray(query?.values) ? query.values : [];
    if (sqlText.includes('semanticDistance') || sqlText.includes('<=>')) {
      const queryVector = String(values[0] ?? '');
      const userId = values[1];
      const kbId = values[2];
      const isAdmin = values[3];

      if (queryVector === '[0,0]') {
        return [];
      }

      const semanticScoresByChunkId =
        queryVector === '[1,0]'
          ? new Map([
              ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { distance: 0.02, similarity: 0.98 }],
              ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', { distance: 0.22, similarity: 0.78 }],
            ])
          : new Map([
              ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { distance: 0.04, similarity: 0.96 }],
              ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', { distance: 0.05, similarity: 0.95 }],
            ]);

      return this.chunks
        .filter((chunk) => chunk.kbId === kbId)
        .filter((chunk) => {
          const kb = this.knowledgeBases.find((item) => item.id === chunk.kbId)!;
          if (isAdmin) {
            return true;
          }
          return kb.members.some((member) => member.userId === userId);
        })
        .filter((chunk) => semanticScoresByChunkId.has(chunk.chunkId))
        .sort((left, right) => {
          const leftScore = semanticScoresByChunkId.get(left.chunkId)!.distance;
          const rightScore = semanticScoresByChunkId.get(right.chunkId)!.distance;
          return leftScore - rightScore;
        })
        .map((chunk) => ({
          chunkId: chunk.chunkId,
          documentId: chunk.documentId,
          documentTitle: chunk.documentTitle,
          documentVersionId: chunk.documentVersionId,
          kbId: chunk.kbId,
          chunkNo: chunk.chunkNo,
          content: chunk.content,
          searchText: chunk.searchText,
          checksum: chunk.checksum,
          sectionTitle: chunk.sectionTitle,
          pageNumber: chunk.pageNumber,
          sourceTitle: chunk.sourceTitle,
          language: chunk.language,
          metadataJson: chunk.metadataJson,
          indexedAt: chunk.indexedAt,
          semanticDistance: semanticScoresByChunkId.get(chunk.chunkId)!.distance,
          semanticSimilarity: semanticScoresByChunkId.get(chunk.chunkId)!.similarity,
        }));
    }

    if (sqlText.includes('ts_rank_cd')) {
      const normalizedQuery = values[0];
      const userId = values[1];
      const kbId = values[2];
      const isAdmin = values[3];
      const queryTerms = String(normalizedQuery)
        .split(' ')
        .filter(Boolean);

      return this.chunks
        .filter((chunk) => chunk.kbId === kbId)
        .filter((chunk) => {
          const kb = this.knowledgeBases.find((item) => item.id === chunk.kbId)!;
          if (isAdmin) {
            return true;
          }
          if (kb.visibility === 'PUBLIC' || kb.visibility === 'INTERNAL') {
            return true;
          }
          return kb.members.some((member) => member.userId === userId);
        })
        .map((chunk) => ({
          ...chunk,
          lexicalScore: queryTerms.reduce(
            (score, term) => score + (chunk.searchText.includes(term) ? 1 : 0),
            0,
          ),
        }))
        .filter((chunk) => chunk.lexicalScore > 0)
        .sort((left, right) => right.lexicalScore - left.lexicalScore)
        .map((chunk) => ({
          chunkId: chunk.chunkId,
          documentId: chunk.documentId,
          documentTitle: chunk.documentTitle,
          documentVersionId: chunk.documentVersionId,
          kbId: chunk.kbId,
          chunkNo: chunk.chunkNo,
          content: chunk.content,
          searchText: chunk.searchText,
          checksum: chunk.checksum,
          sectionTitle: chunk.sectionTitle,
          pageNumber: chunk.pageNumber,
          sourceTitle: chunk.sourceTitle,
          language: chunk.language,
          metadataJson: chunk.metadataJson,
          indexedAt: chunk.indexedAt,
          lexicalScore: chunk.lexicalScore,
        }));
    }

    return [];
  });

  private nextId() {
    const id = `00000000-0000-4000-8000-${String(this.sequence).padStart(12, '0')}`;
    this.sequence += 1;
    return id;
  }

  private nextTimestamp() {
    this.timestampSequence += 1;
    return new Date(1_710_000_000_000 + this.timestampSequence * 1_000);
  }

  private findMatchingConversations(where: any) {
    return this.conversations.filter((conversation) => {
      if (where?.id && conversation.id !== where.id) {
        return false;
      }
      if (where?.userId && conversation.userId !== where.userId) {
        return false;
      }
      if (where?.kbId && conversation.kbId !== where.kbId) {
        return false;
      }
      if (where?.OR?.length) {
        const kb = this.knowledgeBases.find((item) => item.id === conversation.kbId);
        const passesKbScope = where.OR.some((condition: any) => {
          if (condition.kb?.visibility?.in) {
            return kb && condition.kb.visibility.in.includes(kb.visibility);
          }
          if (condition.kb?.members?.some?.userId) {
            return kb?.members.some((member) => member.userId === condition.kb.members.some.userId);
          }
          return false;
        });
        if (!passesKbScope) {
          return false;
        }
      }
      return true;
    });
  }

  private mapConversation(conversation: ConversationRecord, include?: any) {
    return {
      ...conversation,
      ...(include?.kb
        ? {
            kb: this.knowledgeBases.find((kb) => kb.id === conversation.kbId),
          }
        : {}),
      ...(include?.messages
        ? {
            messages: this.messages
              .filter((message) => message.conversationId === conversation.id)
              .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
              .slice(0, include.messages.take ?? 1),
          }
        : {}),
    };
  }
}

function buildRetrievalResult(
  prisma: FakePrismaService,
  params: {
    normalizedQuery: string;
    selectedChunkIds: string[];
    topScoresByChunkId?: Record<string, number>;
    lexicalUsed?: boolean;
    semanticUsed?: boolean;
  },
) {
  const selectedChunks = params.selectedChunkIds.map((chunkId, index) => {
    const chunk = prisma.chunks.find((item) => item.chunkId === chunkId);
    if (!chunk) {
      throw new Error(`Missing chunk ${chunkId}`);
    }

    const hybridScore = params.topScoresByChunkId?.[chunkId] ?? 0.72 - index * 0.04;

    return {
      ...chunk,
      semanticScore: hybridScore,
      lexicalScore: hybridScore - 0.08,
      recencyScore: 0,
      metadataScore: 0,
      structuralScore: 0.12,
      hybridScore,
      semanticRank: index + 1,
      lexicalRank: index + 1,
      debug: {
        retrievedBy: ['semantic', 'lexical'] as const,
        rawSemanticDistance: 0.04 + index * 0.01,
        rawSemanticSimilarity: hybridScore,
        rawLexicalScore: 0.8 - index * 0.05,
        lexicalTokenCoverage: 0.8 - index * 0.1,
        lexicalPhraseCoverage: index === 0 ? 1 : 0,
        metadataSignals: [],
        structuralSignals: index === 0 ? ['section title aligned'] : [],
        selectionReason: 'semantic and lexical retrieval agreed',
        rankBeforeDedup: index + 1,
        rankAfterDedup: index + 1,
        dedupReason: null,
      },
    };
  });

  return {
    normalizedQuery: params.normalizedQuery,
    embeddingsEnabled: true,
    lexicalUsed: params.lexicalUsed ?? true,
    semanticUsed: params.semanticUsed ?? true,
    totalCandidates: selectedChunks.length,
    selectedChunks,
    debug: {
      query: {
        normalizedText: params.normalizedQuery,
        lexicalText: params.normalizedQuery,
        tokens: params.normalizedQuery.split(' '),
        phrases: [],
        freshnessIntent: false,
      },
      limits: {
        semanticTopN: 6,
        lexicalTopN: 6,
        rerankPoolLimit: 6,
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
      rankedCandidates: selectedChunks.map((chunk) => ({
        chunkId: chunk.chunkId,
        documentId: chunk.documentId,
        semanticScore: chunk.semanticScore,
        lexicalScore: chunk.lexicalScore,
        metadataMatchScore: chunk.metadataScore,
        recencyScore: chunk.recencyScore,
        structuralScore: chunk.structuralScore,
        finalScore: chunk.hybridScore,
        selectionReason: chunk.debug.selectionReason,
        rankBeforeDedup: chunk.debug.rankBeforeDedup,
        rankAfterDedup: chunk.debug.rankAfterDedup,
        retrievedBy: chunk.debug.retrievedBy,
        semanticRank: chunk.semanticRank,
        lexicalRank: chunk.lexicalRank,
        dedupReason: chunk.debug.dedupReason,
      })),
    },
  };
}

describe('Chat API', () => {
  let app: INestApplication;
  let prisma: FakePrismaService;

  beforeAll(async () => {
    prisma = new FakePrismaService();
    const retrieval = {
      retrieve: jest.fn(async ({ query }: { query: string }) => {
        const normalizedQuery = query.toLowerCase();
        if (normalizedQuery.includes('reset') && normalizedQuery.includes('worker')) {
          return buildRetrievalResult(prisma, {
            normalizedQuery: 'reset worker',
            selectedChunkIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
            topScoresByChunkId: {
              'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa': 0.76,
            },
          });
        }

        if (normalizedQuery.includes('collect') && normalizedQuery.includes('escalat')) {
          return buildRetrievalResult(prisma, {
            normalizedQuery: 'collect before escalating',
            selectedChunkIds: [
              'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            ],
            topScoresByChunkId: {
              'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa': 0.74,
              'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb': 0.69,
            },
          });
        }

        return buildRetrievalResult(prisma, {
          normalizedQuery: query.toLowerCase(),
          selectedChunkIds: [],
          lexicalUsed: false,
          semanticUsed: false,
        });
      }),
    };
    const authorization = {
      assertKnowledgeBaseRead: jest.fn(async (user: { id: string }, kbId: string) => {
        const kb = prisma.knowledgeBases.find((item) => item.id === kbId);
        if (!kb) {
          throw new ForbiddenException('Knowledge base access denied');
        }
        if (
          kb.members.some((member) => member.userId === user.id) ||
          authorization.isAdmin(user as any)
        ) {
          return { ...kb };
        }
        throw new ForbiddenException('Knowledge base access denied');
      }),
      buildConversationReadWhere: jest.fn((user: { id: string; UserRole?: Array<{ role?: { name?: string } }> }, conversationId?: string) => {
        if (authorization.isAdmin(user as any)) {
          return conversationId ? { id: conversationId } : {};
        }
        return {
          ...(conversationId ? { id: conversationId } : {}),
          userId: user.id,
          OR: [
            { kb: { visibility: { in: ['PUBLIC', 'INTERNAL'] } } },
            { kb: { members: { some: { userId: user.id } } } },
          ],
        };
      }),
      isAdmin: jest.fn((user: { UserRole?: Array<{ role?: { name?: string } }> }) =>
        Boolean(user.UserRole?.some((entry) => entry.role?.name === 'SUPER_ADMIN')),
      ),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [ChatController],
      providers: [
        ChatService,
        { provide: RetrievalService, useValue: retrieval },
        QueryNormalizerService,
        HybridScorerService,
        RetrievalQueryRepository,
        CitationAssemblerService,
        LocalGroundedAnswerService,
        PromptBuilderService,
        ConversationPersistenceService,
        KnowledgeBasesService,
        AuditService,
        {
          provide: MetricsService,
          useValue: {
            increment: jest.fn(),
            recordDuration: jest.fn(),
            snapshot: jest.fn(() => ({})),
          },
        },
        {
          provide: TracingService,
          useValue: {
            startSpan: jest.fn(() => ({
              setAttribute: jest.fn(),
              recordException: jest.fn(),
              end: jest.fn(),
            })),
          },
        },
        {
          provide: JsonLogger,
          useValue: {
            log: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            debug: jest.fn(),
            verbose: jest.fn(),
          },
        },
        { provide: AuthorizationService, useValue: authorization },
        { provide: PrismaService, useValue: prisma },
        { provide: OpenAiGatewayService, useClass: FakeOpenAiGatewayService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(AllowAuthGuard)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers a single-source question with grounded citations', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/chat/ask')
      .send({
        kbId: PRIVATE_KB_ID,
        question: 'How do I reset the worker?',
      })
      .expect(201);

    expect(response.body.status).toBe('grounded');
    expect(response.body.answer).toContain('Reset the worker');
    expect(response.body.citations).toHaveLength(1);
    expect(response.body.citations[0].chunkId).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  });

  it('answers a multi-source question and persists conversation history', async () => {
    const firstTurn = await request(app.getHttpServer())
      .post('/api/v1/chat/ask')
      .send({
        kbId: PRIVATE_KB_ID,
        question: 'How do I reset the worker?',
      })
      .expect(201);

    const secondTurn = await request(app.getHttpServer())
      .post('/api/v1/chat/ask')
      .send({
        conversationId: firstTurn.body.conversationId,
        question: 'What should I collect before escalating?',
      })
      .expect(201);

    expect(secondTurn.body.status).toBe('grounded');
    expect(secondTurn.body.citations).toHaveLength(2);

    const conversation = await request(app.getHttpServer())
      .get(`/api/v1/conversations/${firstTurn.body.conversationId}`)
      .expect(200);

    expect(conversation.body.messages).toHaveLength(4);

    const messages = await request(app.getHttpServer())
      .get(`/api/v1/conversations/${firstTurn.body.conversationId}/messages`)
      .expect(200);

    expect(messages.body).toHaveLength(4);
    expect(messages.body[3].citations).toHaveLength(2);
  });

  it('returns out_of_scope when retrieval hits are not relevant enough', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/chat/ask')
      .send({
        kbId: PRIVATE_KB_ID,
        question: 'What is the vacation policy?',
      })
      .expect(201);

    expect(response.body.status).toBe('out_of_scope');
    expect(response.body.citations).toHaveLength(0);
  });

  it('enforces KB access control for chat requests', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/chat/ask')
      .send({
        kbId: FORBIDDEN_KB_ID,
        question: 'What is in the secret KB?',
      })
      .expect(403);
  });

  it('lists only conversations visible to the current user', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/chat/ask')
      .send({
        kbId: PRIVATE_KB_ID,
        question: 'How do I reset the worker?',
      })
      .expect(201);

    const response = await request(app.getHttpServer())
      .get('/api/v1/conversations')
      .expect(200);

    expect(response.body.length).toBeGreaterThanOrEqual(1);
    expect(response.body.every((item: any) => item.userId === USER_ID)).toBe(true);
  });

  it('returns the latest messages when a smaller conversation limit is requested', async () => {
    const firstTurn = await request(app.getHttpServer())
      .post('/api/v1/chat/ask')
      .send({
        kbId: PRIVATE_KB_ID,
        question: 'How do I reset the worker?',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/v1/chat/ask')
      .send({
        conversationId: firstTurn.body.conversationId,
        question: 'What should I collect before escalating?',
      })
      .expect(201);

    const messages = await request(app.getHttpServer())
      .get(`/api/v1/conversations/${firstTurn.body.conversationId}/messages?limit=2`)
      .expect(200);

    expect(messages.body).toHaveLength(2);
    expect(messages.body[0].role).toBe('USER');
    expect(messages.body[0].content).toContain('collect before escalating');
    expect(messages.body[1].role).toBe('ASSISTANT');
  });

  it('blocks access to an old conversation after KB membership is revoked', async () => {
    const firstTurn = await request(app.getHttpServer())
      .post('/api/v1/chat/ask')
      .send({
        kbId: PRIVATE_KB_ID,
        question: 'How do I reset the worker?',
      })
      .expect(201);

    prisma.knowledgeBases[0].members = [];

    await request(app.getHttpServer())
      .get(`/api/v1/conversations/${firstTurn.body.conversationId}`)
      .expect(404);

    const conversations = await request(app.getHttpServer())
      .get('/api/v1/conversations')
      .expect(200);

    expect(conversations.body.some((item: any) => item.id === firstTurn.body.conversationId)).toBe(
      false,
    );
  });
});
