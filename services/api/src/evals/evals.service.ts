import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  EvalCaseStatus,
  EvalRunStatus,
  EvalSetStatus,
  Prisma,
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../common/audit/audit.service";
import { AuthorizationService } from "../common/authorization/authorization.service";
import { AuthenticatedUser } from "../common/authorization/authorization.types";
import { MetricsService } from "../common/observability/metrics.service";
import { TracingService } from "../common/observability/tracing.service";
import {
  CITATION_POLICY_VERSION,
  CHAT_PROMPT_VERSION,
  GROUNDABLE_EVIDENCE_SCORE_THRESHOLD,
  LOW_EVIDENCE_SCORE_THRESHOLD,
  getCitationLimit,
  getRetrievalCandidateLimit,
  getRetrievalGroundingLimit,
} from "../chat/chat.constants";
import { PromptBuilderService } from "../chat/prompt-builder.service";
import { RetrievalService } from "../chat/retrieval.service";
import { OpenAiGatewayService } from "../chat/openai-gateway.service";
import { CitationAssemblerService } from "../chat/citation-assembler.service";
import { OpenAiGatewayError } from "../openai/openai.types";
import {
  CreateEvalRunDto,
  CreateEvalSetDto,
  ListEvalRunsQueryDto,
  ListEvalSetsQueryDto,
} from "./dto/eval.dto";
import { EvalScoringService } from "./eval-scoring.service";
import {
  EvalExecutionResult,
  EvalRunItemSnapshot,
  EvalRunComparison,
  EvalScoreResult,
} from "./eval.types";
import {
  buildRunSummary,
  buildSummaryOnlyComparison,
  shouldFlagRegression,
} from "./eval-reporting.utils";

type EvalSetWithCases = Prisma.EvalSetGetPayload<{
  include: {
    cases: {
      where: { status: "ACTIVE" };
      orderBy: { createdAt: "asc" };
    };
    kb: {
      select: {
        id: true;
        name: true;
      };
    };
  };
}>;

@Injectable()
export class EvalsService {
  private readonly logger = new Logger(EvalsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly authorization: AuthorizationService,
    private readonly metrics: MetricsService,
    private readonly tracing: TracingService,
    private readonly retrieval: RetrievalService,
    private readonly promptBuilder: PromptBuilderService,
    private readonly openai: OpenAiGatewayService,
    private readonly citations: CitationAssemblerService,
    private readonly scoring: EvalScoringService,
  ) {}

  async listEvalSets(user: AuthenticatedUser, query: ListEvalSetsQueryDto) {
    this.authorization.assertOpsAccess(user);
    return this.prisma.evalSet.findMany({
      where: {
        ...(query.kbId ? { kbId: query.kbId } : {}),
      },
      include: {
        kb: {
          select: {
            id: true,
            name: true,
          },
        },
        _count: {
          select: {
            cases: true,
            runs: true,
          },
        },
      },
      orderBy: [{ createdAt: "desc" }],
    });
  }

  async createEvalSet(user: AuthenticatedUser, dto: CreateEvalSetDto) {
    this.authorization.assertOpsAccess(user);
    const kb = await this.prisma.knowledgeBase.findUnique({
      where: { id: dto.kbId },
      select: { id: true, name: true },
    });
    if (!kb) {
      throw new NotFoundException("Knowledge base not found");
    }

    const created = await this.prisma.evalSet.create({
      data: {
        kbId: dto.kbId,
        name: dto.name,
        description: dto.description,
        status: EvalSetStatus.ACTIVE,
        cases: {
          create: dto.cases.map((evalCase) => ({
            question: evalCase.question,
            expectedAnswer: evalCase.expectedAnswer,
            expectedSourceDocumentId: evalCase.expectedSourceDocumentId,
            expectedSourceHint: evalCase.expectedSourceHint,
            category: evalCase.category ?? "general",
            difficulty: evalCase.difficulty ?? "medium",
            status: evalCase.status ?? EvalCaseStatus.ACTIVE,
          })),
        },
      },
      include: {
        kb: {
          select: {
            id: true,
            name: true,
          },
        },
        cases: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    await this.audit.logAction({
      actorId: user.id,
      action: "EVAL_SET_CREATE",
      entityType: "EvalSet",
      entityId: created.id,
      kbId: dto.kbId,
      metadata: {
        caseCount: dto.cases.length,
        kbName: kb.name,
        name: dto.name,
      },
    });

    return created;
  }

  async listEvalRuns(user: AuthenticatedUser, query: ListEvalRunsQueryDto) {
    this.authorization.assertOpsAccess(user);
    return this.prisma.evalRun.findMany({
      where: {
        ...(query.evalSetId ? { evalSetId: query.evalSetId } : {}),
        ...(query.kbId ? { kbId: query.kbId } : {}),
      },
      include: {
        evalSet: {
          select: {
            id: true,
            name: true,
            kb: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        _count: {
          select: {
            items: true,
          },
        },
      },
      orderBy: [{ startedAt: "desc" }],
    });
  }

  async runEvalSet(
    user: AuthenticatedUser,
    dto: CreateEvalRunDto,
    correlationId?: string,
  ) {
    this.authorization.assertOpsAccess(user);
    if (!this.openai.isConfigured) {
      throw new ServiceUnavailableException(
        "Eval runs require grounded chat to be configured",
      );
    }

    const evalSet = await this.prisma.evalSet.findUnique({
      where: { id: dto.evalSetId },
      include: {
        kb: {
          select: {
            id: true,
            name: true,
          },
        },
        cases: {
          where: { status: EvalCaseStatus.ACTIVE },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!evalSet) {
      throw new NotFoundException("Eval set not found");
    }
    if (!evalSet.cases.length) {
      throw new BadRequestException("Eval set has no active cases");
    }

    const retrievalConfig = {
      candidateLimit:
        dto.retrievalConfig?.candidateLimit ?? getRetrievalCandidateLimit(),
      groundingLimit: Math.min(
        dto.retrievalConfig?.groundingLimit ?? getRetrievalGroundingLimit(),
        this.openai.maxGroundingChunks,
      ),
    };

    const startedAt = new Date();
    const run = await this.prisma.evalRun.create({
      data: {
        evalSetId: evalSet.id,
        kbId: evalSet.kbId,
        modelName: this.openai.configuredChatModel,
        retrievalConfigJson: retrievalConfig as Prisma.InputJsonValue,
        promptVersion: CHAT_PROMPT_VERSION,
        chunkingVersion: process.env.CHUNKING_VERSION || "section_v2",
        startedAt,
        status: EvalRunStatus.RUNNING,
      },
    });

    await this.audit.logAction({
      actorId: user.id,
      action: "EVAL_RUN_START",
      entityType: "EvalRun",
      entityId: run.id,
      kbId: evalSet.kbId,
      metadata: {
        correlationId,
        evalSetId: evalSet.id,
        modelName: this.openai.configuredChatModel,
        retrievalConfig,
      },
    });

    const span = this.tracing.startSpan("eval.run", {
      evalRunId: run.id,
      evalSetId: evalSet.id,
      caseCount: evalSet.cases.length,
    });

    try {
      const previousRun = await this.prisma.evalRun.findFirst({
        where: {
          evalSetId: evalSet.id,
          status: EvalRunStatus.COMPLETED,
          startedAt: { lt: startedAt },
        },
        include: {
          items: {
            select: {
              evalCaseId: true,
              passed: true,
              score: true,
              latencyMs: true,
              notes: true,
              retrievedSourcesJson: true,
            },
          },
        },
        orderBy: [{ startedAt: "desc" }],
      });

      const previousItemMap = new Map(
        (previousRun?.items ?? []).map(
          (item) => [item.evalCaseId, item] as const,
        ),
      );

      const cases = evalSet.cases;
      const itemResults: EvalRunItemSnapshot[] = [];

      for (const evalCase of cases) {
        const caseStartedAt = Date.now();
        let execution: EvalExecutionResult;
        let scoreResult: EvalScoreResult;

        try {
          execution = await this.executeCase(
            user.id,
            evalSet,
            evalCase,
            retrievalConfig,
          );
          scoreResult = this.scoring.scoreCase(evalCase, execution);
        } catch (error) {
          execution = {
            status: "insufficient_data",
            answer: "",
            citations: [],
            usage: {
              inputTokens: 0,
              outputTokens: 0,
              totalTokens: 0,
            },
            latencyMs: Date.now() - caseStartedAt,
            selectedSources: [],
            topScore: 0,
            retrievalDebug: undefined,
            citationDebug: undefined,
          };
          scoreResult = {
            rubricVersion: "practical_v1",
            caseCategory: "general",
            expectedOutcome: "grounded_answer",
            passed: false,
            score: 0,
            notes: `Execution failed: ${error instanceof Error ? error.message : "unknown error"}`,
            failureReasons: ["execution_failed"],
            dimensions: {
              retrieval_source_hit: {
                name: "retrieval_source_hit",
                kind: "automated",
                applicable: true,
                score: 0,
                maxScore: 1,
                passed: false,
                notes: "Execution failed before retrieval scoring completed.",
              },
              evidence_relevance: {
                name: "evidence_relevance",
                kind: "heuristic",
                applicable: true,
                score: 0,
                maxScore: 2,
                passed: false,
                notes: "Execution failed before evidence relevance could be judged.",
              },
              answer_groundedness: {
                name: "answer_groundedness",
                kind: "heuristic",
                applicable: true,
                score: 0,
                maxScore: 2,
                passed: false,
                notes: "Execution failed before answer grounding could be judged.",
              },
              answer_usefulness: {
                name: "answer_usefulness",
                kind: "heuristic",
                applicable: true,
                score: 0,
                maxScore: 2,
                passed: false,
                notes: "Execution failed before answer usefulness could be judged.",
              },
              refusal_quality: {
                name: "refusal_quality",
                kind: "heuristic",
                applicable: false,
                score: null,
                maxScore: 2,
                passed: null,
                notes: "Execution failed before refusal quality could be judged.",
              },
              citation_integrity: {
                name: "citation_integrity",
                kind: "automated",
                applicable: true,
                score: 0,
                maxScore: 2,
                passed: false,
                notes: "Execution failed before citation integrity could be judged.",
              },
            },
            sourceHit: false,
            evidenceRelevant: false,
            grounded: false,
            useful: false,
            citationIntegrity: false,
            correctRefusal: false,
            expectedSourceCited: false,
            answerMatchScore: 0,
            requiresHumanReview: true,
            secondaryMetrics: {
              latencyMs: Date.now() - caseStartedAt,
              usage: execution.usage,
              topScore: 0,
              citationCount: 0,
              retrievedSourceCount: 0,
              distinctRetrievedDocuments: 0,
              distinctCitedDocuments: 0,
            },
          };
          this.logger.error(
            JSON.stringify({
              correlationId: correlationId ?? null,
              evalCaseId: evalCase.id,
              evalRunId: run.id,
              event: "eval_case_failed",
              message: error instanceof Error ? error.message : "unknown error",
            }),
          );
        }

        const previousItem = previousItemMap.get(evalCase.id);
        const currentItemBase: EvalRunItemSnapshot = {
          evalCaseId: evalCase.id,
          question: evalCase.question,
          category: evalCase.category,
          passed: scoreResult.passed,
          score: scoreResult.score,
          regressionFlag: false,
          latencyMs: execution.latencyMs,
          usage: execution.usage,
          executionStatus: execution.status,
          breakdown: scoreResult,
        };
        const regressionFlag = shouldFlagRegression({
          currentItem: currentItemBase,
          previousItem,
        });
        const currentItem: EvalRunItemSnapshot = {
          ...currentItemBase,
          regressionFlag,
        };

        await this.prisma.evalItem.create({
          data: {
            evalRunId: run.id,
            evalCaseId: evalCase.id,
            actualAnswer: execution.answer,
            retrievedSourcesJson: {
              rubricVersion: scoreResult.rubricVersion,
              status: execution.status,
              topScore: Number(execution.topScore.toFixed(4)),
              sources: execution.selectedSources,
              citations: execution.citations,
              citationChunkIds: execution.citations.map((citation) => citation.chunkId),
              retrievalDebug: execution.retrievalDebug ?? null,
              citationDebug: execution.citationDebug ?? null,
              usage: execution.usage,
              breakdown: {
                rubricVersion: scoreResult.rubricVersion,
                caseCategory: scoreResult.caseCategory,
                expectedOutcome: scoreResult.expectedOutcome,
                sourceHit: scoreResult.sourceHit,
                evidenceRelevant: scoreResult.evidenceRelevant,
                grounded: scoreResult.grounded,
                useful: scoreResult.useful,
                citationIntegrity: scoreResult.citationIntegrity,
                answerMatchScore: scoreResult.answerMatchScore,
                correctRefusal: scoreResult.correctRefusal,
                expectedSourceCited: scoreResult.expectedSourceCited,
                requiresHumanReview: scoreResult.requiresHumanReview,
                failureReasons: scoreResult.failureReasons,
                notes: scoreResult.notes,
                dimensions: scoreResult.dimensions,
                secondaryMetrics: scoreResult.secondaryMetrics,
              },
            } as unknown as Prisma.InputJsonValue,
            passed: scoreResult.passed,
            score: scoreResult.score,
            notes: scoreResult.notes || null,
            regressionFlag,
            latencyMs: execution.latencyMs,
            usageJson: execution.usage as unknown as Prisma.InputJsonValue,
          },
        });

        itemResults.push(currentItem);

        this.metrics.increment("eval_cases_total", 1, {
          status: execution.status,
          passed: scoreResult.passed,
        });
        if (scoreResult.passed) {
          this.metrics.increment("eval_cases_passed_total");
        }
      }

      const finishedAt = new Date();
      const summary = buildRunSummary({
        runId: run.id,
        items: itemResults,
        previousRun: previousRun
          ? {
              id: previousRun.id,
              summaryJson:
                (previousRun.summaryJson as Record<string, unknown> | null) ?? null,
              items: previousRun.items.map((item) => ({
                evalCaseId: item.evalCaseId,
                passed: item.passed,
                score: item.score,
                latencyMs: item.latencyMs,
                notes: item.notes,
                retrievedSourcesJson: item.retrievedSourcesJson,
              })),
            }
          : null,
      });
      const passRate = Number(summary.passRate ?? 0);

      await this.prisma.evalRun.update({
        where: { id: run.id },
        data: {
          finishedAt,
          status: EvalRunStatus.COMPLETED,
          summaryJson: summary as unknown as Prisma.InputJsonValue,
        },
      });

      const durationMs = finishedAt.getTime() - startedAt.getTime();
      this.metrics.increment("eval_runs_total", 1, { status: "completed" });
      this.metrics.recordDuration("eval_run_duration_ms", durationMs, {
        eval_set_id: evalSet.id,
      });

      await this.audit.logAction({
        actorId: user.id,
        action: "EVAL_RUN_COMPLETE",
        entityType: "EvalRun",
        entityId: run.id,
        kbId: evalSet.kbId,
        metadata: {
          comparisonToPrevious: summary.comparisonToPrevious ?? null,
          correlationId,
          durationMs,
          evalSetId: evalSet.id,
          passRate,
          refusalCorrectnessRate: summary.refusalCorrectnessRate,
          groundednessRate: summary.groundednessRate,
          retrievalHitRate: summary.retrievalHitRate,
        },
      });

      span.end({
        durationMs,
        passRate,
        status: "completed",
      });

      return this.getEvalRun(user, run.id);
    } catch (error) {
      const finishedAt = new Date();
      await this.prisma.evalRun.update({
        where: { id: run.id },
        data: {
          finishedAt,
          status: EvalRunStatus.FAILED,
          summaryJson: {
            error: error instanceof Error ? error.message : "unknown error",
          } as Prisma.InputJsonValue,
        },
      });

      this.metrics.increment("eval_runs_total", 1, { status: "failed" });
      span.recordException(error);
      span.end({ status: "failed" });
      throw error;
    }
  }

  async getEvalRun(user: AuthenticatedUser, runId: string) {
    this.authorization.assertOpsAccess(user);
    const run = await this.prisma.evalRun.findUnique({
      where: { id: runId },
      include: {
        evalSet: {
          include: {
            kb: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        items: {
          include: {
            evalCase: true,
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!run) {
      throw new NotFoundException("Eval run not found");
    }

    const previousRun = await this.prisma.evalRun.findFirst({
      where: {
        evalSetId: run.evalSetId,
        status: EvalRunStatus.COMPLETED,
        startedAt: { lt: run.startedAt },
      },
      select: {
        id: true,
        summaryJson: true,
      },
      orderBy: { startedAt: "desc" },
    });

    const summary = (run.summaryJson ?? {}) as Record<string, unknown>;
    const comparison =
      (summary.comparisonToPrevious as EvalRunComparison | undefined) ??
      buildSummaryOnlyComparison({
        currentSummary: summary,
        previousSummary: (previousRun?.summaryJson as Record<string, unknown> | null) ?? null,
        previousRunId: previousRun?.id,
      });

    return {
      ...run,
      comparisonToPrevious: comparison,
    };
  }

  private async executeCase(
    actorId: string,
    evalSet: EvalSetWithCases,
    evalCase: EvalSetWithCases["cases"][number],
    retrievalConfig: {
      candidateLimit: number;
      groundingLimit: number;
    },
  ): Promise<EvalExecutionResult> {
    const startedAt = Date.now();
    const indexedChunkCount = await this.prisma.documentChunk.count({
      where: {
        kbId: evalSet.kbId,
        supersededAt: null,
        document: { status: "INDEXED" },
        documentVersion: { status: "INDEXED" },
      },
    });

    const retrieval = await this.retrieval.retrieve({
      kbId: evalSet.kbId,
      userId: actorId,
      isAdmin: true,
      query: evalCase.question,
      candidateLimit: retrievalConfig.candidateLimit,
      groundingLimit: retrievalConfig.groundingLimit,
    });
    this.assertRetrievedChunksStayInKb(retrieval.selectedChunks, evalSet.kbId);

    const topScore = retrieval.selectedChunks[0]?.hybridScore ?? 0;
    if (indexedChunkCount === 0) {
      return {
        status: "insufficient_data",
        answer:
          "I do not have enough indexed information in this knowledge base to answer that yet.",
        citations: [],
        latencyMs: Date.now() - startedAt,
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        selectedSources: [],
        topScore,
        retrievalDebug: retrieval.debug,
        citationDebug: undefined,
      };
    }

    if (
      !retrieval.selectedChunks.length ||
      topScore < LOW_EVIDENCE_SCORE_THRESHOLD
    ) {
      return {
        status: "out_of_scope",
        answer:
          "I could not find relevant support material in the selected knowledge base for that question.",
        citations: [],
        latencyMs: Date.now() - startedAt,
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        selectedSources: [],
        topScore,
        retrievalDebug: retrieval.debug,
        citationDebug: undefined,
      };
    }

    const prompt = this.promptBuilder.build({
      question: evalCase.question,
      evidenceStrength:
        topScore >= 0.6
          ? "high"
          : topScore >= GROUNDABLE_EVIDENCE_SCORE_THRESHOLD
            ? "medium"
            : "low",
      conversationHistory: [],
      selectedChunks: retrieval.selectedChunks,
    });

    const modelResult = await this.createGroundedAnswerOrThrow(
      prompt,
      evalSet.kbId,
      retrieval.selectedChunks.length,
    );
    const citationAssembly =
      modelResult.answer.status === "grounded"
        ? this.citations.assemble({
            usedChunkIds: modelResult.answer.usedChunkIds,
            selectedChunks: retrieval.selectedChunks,
            normalizedQuery: retrieval.normalizedQuery,
            answerText: modelResult.answer.answer,
          })
        : {
            citations: [],
            debug: {
              policyVersion: CITATION_POLICY_VERSION,
              granularity: "answer_level" as const,
              maxCitations: getCitationLimit(),
              requestedChunkIds: [],
              acceptedChunkIds: [],
              rejectedChunkIds: [],
            },
          };

    let status = modelResult.answer.status;
    let answerText = modelResult.answer.answer;
    if (status === "grounded" && citationAssembly.citations.length === 0) {
      status = "insufficient_data";
      answerText =
        "I could not assemble a citation-backed answer from the available sources.";
    }

    return {
      status,
      answer: answerText,
      citations: citationAssembly.citations,
      usage: modelResult.usage,
      latencyMs: Date.now() - startedAt,
      selectedSources: retrieval.selectedChunks.map((chunk) => ({
        chunkId: chunk.chunkId,
        documentId: chunk.documentId,
        documentTitle: chunk.documentTitle,
        score: Number(chunk.hybridScore.toFixed(6)),
        page: chunk.pageNumber,
        section: chunk.sectionTitle,
        snippet: this.toEvidenceSnippet(chunk.content),
      })),
      topScore,
      retrievalDebug: retrieval.debug,
      citationDebug: citationAssembly.debug,
    };
  }

  private assertRetrievedChunksStayInKb(
    selectedChunks: Array<{ chunkId: string; kbId: string }>,
    kbId: string,
  ) {
    const invalidChunk = selectedChunks.find((chunk) => chunk.kbId !== kbId);
    if (!invalidChunk) {
      return;
    }

    this.logger.error(
      JSON.stringify({
        event: "eval_retrieval_kb_integrity_violation",
        expectedKbId: kbId,
        invalidChunkId: invalidChunk.chunkId,
        invalidChunkKbId: invalidChunk.kbId,
      }),
    );
      throw new ServiceUnavailableException("Retrieval integrity check failed");
  }

  private toEvidenceSnippet(content: string) {
    return content.replace(/\s+/g, " ").trim().slice(0, 280);
  }

  private async createGroundedAnswerOrThrow(
    prompt: { instructions: string; input: string },
    kbId: string,
    groundingChunkCount: number,
  ) {
    try {
      return await this.openai.createGroundedAnswer(prompt, {
        kbId,
        requestType: "eval_grounded_chat",
        batchSize: groundingChunkCount,
      });
    } catch (error) {
      if (error instanceof OpenAiGatewayError) {
        this.logger.error(
          JSON.stringify({
            errorCode: error.code,
            event: "eval_answer_generation_failed",
            kbId,
            requestType: error.requestType,
            retryable: error.retryable,
          }),
        );
        throw new ServiceUnavailableException("Eval answer generation failed");
      }

      throw error;
    }
  }
}
