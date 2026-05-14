import { ForbiddenException } from "@nestjs/common";
import { SystemRole } from "@prisma/client";
import { EvalsService } from "./evals.service";
import { EvalScoringService } from "./eval-scoring.service";

describe("EvalsService", () => {
  it("runs eval cases, stores item results, and reports regression deltas against the previous run", async () => {
    const createdItems: any[] = [];
    let updatedRun: any = null;

    const previousRun = {
      id: "run-prev",
      summaryJson: {
        passRate: 1,
        retrievalHitRate: 1,
        groundednessRate: 1,
        refusalCorrectnessRate: 0,
        citationIntegrityRate: 1,
        averageLatencyMs: 100,
        averageScore: 1,
        regressionCount: 0,
      },
      items: [{ evalCaseId: "case-1", passed: true, score: 1, latencyMs: 100 }],
    };

    const prisma = {
      knowledgeBase: {
        findUnique: jest.fn(),
      },
      evalSet: {
        findUnique: jest.fn(async () => ({
          id: "set-1",
          kbId: "kb-1",
          kb: { id: "kb-1", name: "Support KB" },
          cases: [
            {
              id: "case-1",
              question: "How do I reset the worker?",
              expectedAnswer:
                "Reset the worker before retrying the failed job.",
              expectedSourceDocumentId: "doc-expected",
              expectedSourceHint: null,
              category: "general",
              difficulty: "medium",
              status: "ACTIVE",
              createdAt: new Date(),
            },
          ],
        })),
      },
      evalRun: {
        create: jest.fn(async ({ data }: any) => ({
          id: "run-current",
          ...data,
        })),
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(previousRun)
          .mockResolvedValueOnce({
            id: "run-prev",
            summaryJson: previousRun.summaryJson,
          }),
        update: jest.fn(async ({ where, data }: any) => {
          updatedRun = {
            id: where.id,
            ...data,
          };
          return updatedRun;
        }),
        findUnique: jest.fn(async () => ({
          id: "run-current",
          evalSetId: "set-1",
          kbId: "kb-1",
          modelName: "gpt-5",
          retrievalConfigJson: { candidateLimit: 24, groundingLimit: 6 },
          promptVersion: "grounded_v1",
          chunkingVersion: "section_v2",
          startedAt: new Date("2026-04-04T10:00:00Z"),
          finishedAt: new Date("2026-04-04T10:00:02Z"),
          status: "COMPLETED",
          summaryJson: updatedRun.summaryJson,
          evalSet: {
            id: "set-1",
            name: "Smoke Set",
            kbId: "kb-1",
            kb: { id: "kb-1", name: "Support KB" },
          },
          items: createdItems.map((item) => ({
            ...item,
            evalCase: {
              id: "case-1",
              question: "How do I reset the worker?",
            },
          })),
        })),
      },
      evalItem: {
        create: jest.fn(async ({ data }: any) => {
          createdItems.push(data);
          return data;
        }),
      },
      documentChunk: {
        count: jest.fn(async () => 3),
      },
    } as any;

    const authorization = {
      assertOpsAccess: jest.fn(),
    } as any;
    const audit = { logAction: jest.fn() } as any;
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
    const retrieval = {
      retrieve: jest.fn(async () => ({
        normalizedQuery: "reset worker",
        embeddingsEnabled: false,
        lexicalUsed: true,
        semanticUsed: false,
        totalCandidates: 1,
        selectedChunks: [
          {
            chunkId: "chunk-1",
            documentId: "doc-other",
            documentTitle: "Other Runbook",
            documentVersionId: "ver-1",
            kbId: "kb-1",
            chunkNo: 1,
            content: "Reset the worker before retrying the failed job.",
            searchText: "reset the worker before retrying the failed job",
            checksum: "checksum-1",
            sectionTitle: "Troubleshooting",
            pageNumber: 3,
            sourceTitle: "Other Runbook",
            language: "en",
            metadataJson: null,
            semanticScore: 0,
            lexicalScore: 0.8,
            recencyScore: 0.9,
            metadataScore: 0,
            hybridScore: 0.7,
            semanticRank: null,
            lexicalRank: 1,
            indexedAt: new Date("2026-04-03T00:00:00Z"),
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
      })),
    } as any;
    const promptBuilder = {
      build: jest.fn(() => ({
        instructions: "Use only provided context",
        input: "Question: How do I reset the worker?",
      })),
    } as any;
    const openai = {
      isConfigured: true,
      configuredChatModel: "gpt-5",
      maxGroundingChunks: 6,
      createGroundedAnswer: jest.fn(async () => ({
        answer: {
          status: "grounded",
          answer: "Reset the worker before retrying the failed job.",
          usedChunkIds: ["chunk-1"],
        },
        usage: {
          inputTokens: 100,
          outputTokens: 20,
          totalTokens: 120,
        },
      })),
    } as any;
    const citations = {
      assemble: jest.fn(() => ({
        citations: [
          {
            rank: 1,
            score: 0.7,
            chunkId: "chunk-1",
            documentId: "doc-other",
            documentTitle: "Other Runbook",
            snippet: "Reset the worker before retrying the failed job.",
            page: 3,
            section: "Troubleshooting",
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
      })),
    } as any;

    const service = new EvalsService(
      prisma,
      audit,
      authorization,
      metrics,
      tracing,
      retrieval,
      promptBuilder,
      openai,
      citations,
      new EvalScoringService(),
    );

    const result = await service.runEvalSet(
      {
        id: "operator-1",
        UserRole: [{ role: { name: SystemRole.OPERATOR } }],
      },
      { evalSetId: "set-1" },
      "corr-1",
    );

    expect(openai.createGroundedAnswer).toHaveBeenCalledTimes(1);
    expect(createdItems).toHaveLength(1);
    expect(createdItems[0].passed).toBe(false);
    expect(createdItems[0].regressionFlag).toBe(true);
    expect(result.comparisonToPrevious.passRateDelta).toBe(-1);
    expect(result.comparisonToPrevious.retrievalHitRateDelta).toBe(-1);
    expect(result.comparisonToPrevious.groundednessRateDelta).toBe(0);
    expect(result.items[0].notes).toContain("Expected source");
    expect(createdItems[0].retrievedSourcesJson.citations).toHaveLength(1);
    expect(authorization.assertOpsAccess).toHaveBeenCalled();
  });

  it("rejects non-operators from eval service methods", async () => {
    const authorization = {
      assertOpsAccess: jest.fn(() => {
        throw new ForbiddenException("Operator access required");
      }),
    } as any;

    const service = new EvalsService(
      {} as any,
      { logAction: jest.fn() } as any,
      authorization,
      { increment: jest.fn(), recordDuration: jest.fn() } as any,
      { startSpan: jest.fn() } as any,
      {} as any,
      {} as any,
      { isConfigured: true, maxGroundingChunks: 6 } as any,
      {} as any,
      new EvalScoringService(),
    );

    await expect(
      service.listEvalSets({ id: "user-1" }, {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
