import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import {
  DocumentStatus,
  DocumentVersionStatus,
  EvalRunStatus,
  IngestJobStatus,
  Prisma,
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../common/audit/audit.service";
import { AuthorizationService } from "../common/authorization/authorization.service";
import { AuthenticatedUser } from "../common/authorization/authorization.types";
import { emitMetricsExportIfRegistered } from "../common/observability/metrics-extension";
import { MetricsService } from "../common/observability/metrics.service";
import { TracingService } from "../common/observability/tracing.service";
import {
  DEFAULT_INGEST_MAX_ATTEMPTS,
  INGEST_JOB_NAME,
  INGEST_QUEUE_NAME,
  INGEST_PIPELINE_VERSION,
} from "../documents/documents.constants";
import {
  getS3Bucket,
  isOpenAiEmbeddingsAvailable,
} from "../config/runtime-config";
import {
  buildIngestQueueOptions,
  buildIngestQueuePayload,
  getInitialVectorizationStatus,
  markQueueEnqueueFailure,
} from "../documents/ingest-job.helpers";

@Injectable()
export class OpsService {
  private readonly logger = new Logger(OpsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly authorization: AuthorizationService,
    private readonly metrics: MetricsService,
    private readonly tracing: TracingService,
    @InjectQueue(INGEST_QUEUE_NAME) private readonly ingestQueue: Queue,
  ) {}

  async listFailedJobs(user: AuthenticatedUser, limit = 50) {
    this.authorization.assertOpsAccess(user);
    return this.prisma.ingestJob.findMany({
      where: {
        status: {
          in: [IngestJobStatus.FAILED, IngestJobStatus.DEAD_LETTER],
        },
      },
      include: {
        documentVersion: {
          include: {
            document: {
              select: {
                id: true,
                kbId: true,
                name: true,
                status: true,
              },
            },
          },
        },
      },
      orderBy: [{ finishedAt: "desc" }, { updatedAt: "desc" }],
      take: Math.max(1, Math.min(limit, 200)),
    });
  }

  async retryIngestJob(
    jobId: string,
    user: AuthenticatedUser,
    correlationId?: string,
  ) {
    this.authorization.assertOpsAccess(user);
    const existing = await this.prisma.ingestJob.findUnique({
      where: { id: jobId },
      include: {
        documentVersion: {
          include: {
            document: true,
          },
        },
      },
    });

    if (!existing) {
      throw new NotFoundException("Ingest job not found");
    }
    if (
      existing.status !== IngestJobStatus.FAILED &&
      existing.status !== IngestJobStatus.DEAD_LETTER
    ) {
      throw new BadRequestException(
        "Only failed or dead-letter jobs can be retried",
      );
    }

    const latestJob = await this.prisma.ingestJob.findFirst({
      where: { documentVersionId: existing.documentVersionId },
      orderBy: [{ createdAt: "desc" }],
      select: {
        id: true,
        status: true,
      },
    });
    if (!latestJob || latestJob.id !== existing.id) {
      throw new BadRequestException(
        "Only the latest ingest job for a version can be retried",
      );
    }

    const activeSibling = await this.prisma.ingestJob.findFirst({
      where: {
        documentVersionId: existing.documentVersionId,
        status: {
          in: [IngestJobStatus.WAITING, IngestJobStatus.ACTIVE],
        },
      },
      select: { id: true },
    });
    if (activeSibling) {
      throw new BadRequestException(
        "An ingest job is already queued or running for this version",
      );
    }

    const span = this.tracing.startSpan("ops.retry_ingest_job", {
      ingestJobId: jobId,
      documentId: existing.documentVersion.documentId,
    });

    const refreshed = await this.prisma.$transaction(async (tx) => {
      const version = await tx.documentVersion.update({
        where: { id: existing.documentVersionId },
        data: {
          status: DocumentVersionStatus.QUEUED,
          ingestVersion: { increment: 1 },
          pipelineVersion: INGEST_PIPELINE_VERSION,
          vectorizationStatus: this.initialVectorizationStatus(),
          lastErrorCode: null,
          lastErrorMessage: null,
          startedAt: null,
          finishedAt: null,
        },
      });

      const document = await tx.document.update({
        where: { id: existing.documentVersion.document.id },
        data: {
          status: DocumentStatus.QUEUED,
          lastErrorCode: null,
          lastErrorMessage: null,
        },
      });

      const ingestJob = await tx.ingestJob.create({
        data: {
          documentVersionId: existing.documentVersionId,
          status: IngestJobStatus.WAITING,
          correlationId,
          maxAttempts: existing.maxAttempts || DEFAULT_INGEST_MAX_ATTEMPTS,
        },
      });

      return { document, version, ingestJob };
    });

    try {
      await this.ingestQueue.add(
        INGEST_JOB_NAME,
        buildIngestQueuePayload({
          correlationId,
          document: {
            id: refreshed.document.id,
            kbId: refreshed.document.kbId,
            name: refreshed.document.name,
            type: refreshed.document.type,
          },
          version: {
            id: refreshed.version.id,
            ingestVersion: refreshed.version.ingestVersion,
            pipelineVersion: refreshed.version.pipelineVersion,
            storageBucket:
              refreshed.version.storageBucket ??
              existing.documentVersion.storageBucket ??
              getS3Bucket(),
            s3Key: existing.documentVersion.s3Key,
          },
          ingestJob: {
            id: refreshed.ingestJob.id,
            maxAttempts: refreshed.ingestJob.maxAttempts,
          },
        }),
        buildIngestQueueOptions(
          refreshed.ingestJob.id,
          refreshed.ingestJob.maxAttempts,
        ),
      );
    } catch (error) {
      await this.prisma.$transaction(async (tx) => {
        await markQueueEnqueueFailure(tx, {
          documentId: refreshed.document.id,
          documentVersionId: refreshed.version.id,
          ingestJobId: refreshed.ingestJob.id,
          message: "Failed to enqueue retry job",
        });
      });

      span.recordException(error);
      span.end({ status: "enqueue_failed" });
      throw new InternalServerErrorException("Failed to enqueue retry job");
    }

    this.metrics.increment("ingest_job_retries_total");
    await this.audit.logAction({
      actorId: user.id,
      action: "OPS_RETRY_INGEST_JOB",
      entityType: "IngestJob",
      entityId: refreshed.ingestJob.id,
      kbId: refreshed.document.kbId,
      metadata: {
        correlationId,
        previousIngestJobId: existing.id,
        documentId: refreshed.document.id,
        documentVersionId: refreshed.version.id,
      },
    });

    this.logger.log(
      JSON.stringify({
        correlationId: correlationId ?? null,
        previousIngestJobId: existing.id,
        ingestJobId: refreshed.ingestJob.id,
        event: "ops_retry_enqueued",
      }),
    );

    span.end({ status: "enqueued" });
    return {
      retriedFromJobId: existing.id,
      ingestJobId: refreshed.ingestJob.id,
      documentId: refreshed.document.id,
      documentVersionId: refreshed.version.id,
      status: refreshed.ingestJob.status,
      attempts: refreshed.ingestJob.attempts,
      maxAttempts: refreshed.ingestJob.maxAttempts,
      ingestVersion: refreshed.version.ingestVersion,
      correlationId: refreshed.ingestJob.correlationId,
    };
  }

  async getMetricsSnapshot(user: AuthenticatedUser) {
    this.authorization.assertOpsAccess(user);
    const [
      failedJobs,
      waitingJobs,
      activeJobs,
      completedJobs,
      averageIngestionDuration,
      latestCompletedEval,
    ] = await Promise.all([
      this.prisma.ingestJob.count({
        where: {
          status: { in: [IngestJobStatus.FAILED, IngestJobStatus.DEAD_LETTER] },
        },
      }),
      this.prisma.ingestJob.count({
        where: { status: IngestJobStatus.WAITING },
      }),
      this.prisma.ingestJob.count({
        where: { status: IngestJobStatus.ACTIVE },
      }),
      this.prisma.ingestJob.count({
        where: { status: IngestJobStatus.COMPLETED },
      }),
      this.prisma.$queryRaw<Array<{ averageMs: number | null }>>(Prisma.sql`
        SELECT AVG(EXTRACT(EPOCH FROM ("finishedAt" - "startedAt")) * 1000) AS "averageMs"
        FROM "DocumentVersion"
        WHERE "startedAt" IS NOT NULL AND "finishedAt" IS NOT NULL
      `),
      this.prisma.evalRun.findFirst({
        where: { status: EvalRunStatus.COMPLETED },
        select: {
          id: true,
          summaryJson: true,
          startedAt: true,
        },
        orderBy: { startedAt: "desc" },
      }),
    ]);

    const metricsSnapshot = this.metrics.snapshot();
    emitMetricsExportIfRegistered(metricsSnapshot);

    return {
      metrics: metricsSnapshot,
      ingestion: {
        failedJobs,
        waitingJobs,
        activeJobs,
        completedJobs,
        averageDurationMs: Number(
          Number(averageIngestionDuration[0]?.averageMs ?? 0).toFixed(2),
        ),
      },
      evals: latestCompletedEval
        ? {
            latestRunId: latestCompletedEval.id,
            latestSummary: latestCompletedEval.summaryJson,
            startedAt: latestCompletedEval.startedAt,
          }
        : null,
      capturedAt: new Date().toISOString(),
    };
  }

  private initialVectorizationStatus() {
    return getInitialVectorizationStatus(isOpenAiEmbeddingsAvailable());
  }
}
