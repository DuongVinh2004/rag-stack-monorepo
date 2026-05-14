import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from "@nestjs/common";
import {
  DocumentStatus,
  DocumentVersionStatus,
  IngestJobStatus,
  KbRole,
} from "@prisma/client";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import * as crypto from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { KnowledgeBasesService } from "../knowledge-bases/knowledge-bases.service";
import { AuthorizationService } from "../common/authorization/authorization.service";
import { AuthenticatedUser } from "../common/authorization/authorization.types";
import { StorageService } from "../common/storage/storage.service";
import { AuditService } from "../common/audit/audit.service";
import {
  getS3Bucket,
  getUploadMaxBytes,
  isOpenAiEmbeddingsAvailable,
} from "../config/runtime-config";
import {
  INGEST_JOB_NAME,
  INGEST_PIPELINE_VERSION,
  INGEST_QUEUE_NAME,
} from "./documents.constants";
import {
  EnqueueableIngestJob,
  buildIngestQueueOptions,
  buildIngestQueuePayload,
  getConfiguredIngestMaxAttempts,
  getInitialVectorizationStatus,
  markQueueEnqueueFailure,
} from "./ingest-job.helpers";
import {
  inspectUploadedDocument,
  sanitizeDisplayName,
} from "./document-upload.helpers";
import {
  toDocumentDetailView,
  toDocumentListItemView,
} from "./document-view.mapper";

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private prisma: PrismaService,
    private kbService: KnowledgeBasesService,
    private readonly authorization: AuthorizationService,
    private storageService: StorageService,
    private audit: AuditService,
    @InjectQueue(INGEST_QUEUE_NAME) private ingestQueue: Queue,
  ) {}

  async uploadDocument(
    user: AuthenticatedUser,
    kbId: string,
    name: string,
    file: Express.Multer.File,
    correlationId?: string,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException("Document file is required");
    }
    if (file.size > getUploadMaxBytes()) {
      throw new BadRequestException(
        "Uploaded file exceeds the configured size limit",
      );
    }
    const inspectedUpload = inspectUploadedDocument(file);

    await this.kbService.assertKbAccess(kbId, user, [
      KbRole.OWNER,
      KbRole.EDITOR,
    ]);

    const contentHash = crypto
      .createHash("sha256")
      .update(file.buffer)
      .digest("hex");
    const bucket = getS3Bucket();
    const s3Key = `${kbId}/${contentHash}-${inspectedUpload.storageFilename}`;
    const safeDocumentName = sanitizeDisplayName(name);

    await this.storageService.uploadFile(
      bucket,
      s3Key,
      file.buffer,
      inspectedUpload.mimeType,
    );

    const created = await this.createDocumentRecords({
      kbId,
      name: safeDocumentName,
      mimetype: inspectedUpload.mimeType,
      storageBucket: bucket,
      s3Key,
      contentHash,
      correlationId,
    });

    await this.enqueueIngestJob({
      correlationId,
      document: created.document,
      version: created.version,
      ingestJob: created.ingestJob,
    });

    await this.audit.logAction({
      actorId: user.id,
      action: "DOCUMENT_UPLOAD",
      entityType: "Document",
      entityId: created.document.id,
      kbId,
      metadata: {
        correlationId,
        contentHash,
        mimeType: inspectedUpload.mimeType,
        name: safeDocumentName,
        objectKeyHash: this.hashForAudit(s3Key),
      },
    });

    return this.findOne(created.document.id, user);
  }

  async reindexDocument(
    documentId: string,
    user: AuthenticatedUser,
    correlationId?: string,
  ) {
    const existing = await this.authorization.assertDocumentRead(
      user,
      documentId,
      {
        versions: {
          orderBy: [{ versionNumber: "desc" }, { createdAt: "desc" }],
          take: 1,
        },
      },
    );

    await this.kbService.assertKbAccess(existing.kbId, user, [
      KbRole.OWNER,
      KbRole.EDITOR,
    ]);

    const latestVersion = existing.versions[0];
    if (!latestVersion) {
      throw new BadRequestException("Document has no version to reindex");
    }

    const activeJob = await this.prisma.ingestJob.findFirst({
      where: {
        documentVersionId: latestVersion.id,
        status: {
          in: [IngestJobStatus.WAITING, IngestJobStatus.ACTIVE],
        },
      },
      select: {
        id: true,
      },
    });
    if (activeJob) {
      throw new BadRequestException(
        "Document version already has an active ingest job",
      );
    }

    const refreshed = await this.prisma.$transaction(async (tx) => {
      const document = await tx.document.update({
        where: { id: existing.id },
        data: {
          status: DocumentStatus.QUEUED,
          lastErrorCode: null,
          lastErrorMessage: null,
        },
      });

      const version = await tx.documentVersion.update({
        where: { id: latestVersion.id },
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

      const ingestJob = await tx.ingestJob.create({
        data: {
          documentVersionId: latestVersion.id,
          status: IngestJobStatus.WAITING,
          correlationId,
          maxAttempts: this.getMaxAttempts(),
        },
      });

      return { document, version, ingestJob };
    });

    await this.enqueueIngestJob({
      correlationId,
      document: refreshed.document,
      version: {
        ...refreshed.version,
        storageBucket: refreshed.version.storageBucket ?? getS3Bucket(),
      },
      ingestJob: refreshed.ingestJob,
    });

    await this.audit.logAction({
      actorId: user.id,
      action: "DOCUMENT_REINDEX",
      entityType: "Document",
      entityId: documentId,
      kbId: existing.kbId,
      metadata: {
        correlationId,
        ingestJobId: refreshed.ingestJob.id,
        ingestVersion: refreshed.version.ingestVersion,
      },
    });

    return this.findOne(documentId, user);
  }

  async findAll(kbId: string, user: AuthenticatedUser) {
    await this.kbService.assertKbAccess(kbId, user, [
      KbRole.OWNER,
      KbRole.EDITOR,
      KbRole.VIEWER,
    ]);
    const documents = await this.prisma.document.findMany({
      where: {
        ...this.authorization.buildDocumentReadWhere(user),
        kbId,
      },
      include: {
        versions: {
          orderBy: [{ versionNumber: "desc" }, { createdAt: "desc" }],
          take: 1,
          include: {
            ingestJobs: {
              orderBy: [{ createdAt: "desc" }],
              take: 1,
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return documents.map((document) => toDocumentListItemView(document));
  }

  async findOne(id: string, user: AuthenticatedUser) {
    const doc = await this.authorization.assertDocumentRead(user, id, {
      versions: {
        orderBy: [{ versionNumber: "desc" }, { createdAt: "desc" }],
        take: 1,
        include: {
          ingestJobs: {
            orderBy: [{ createdAt: "desc" }],
            take: 5,
          },
        },
      },
    });
    return toDocumentDetailView(doc, isOpenAiEmbeddingsAvailable());
  }

  private async createDocumentRecords(params: {
    kbId: string;
    name: string;
    mimetype: string;
    storageBucket: string;
    s3Key: string;
    contentHash: string;
    correlationId?: string;
  }) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const document = await tx.document.create({
          data: {
            kbId: params.kbId,
            name: params.name,
            type: params.mimetype,
            status: DocumentStatus.QUEUED,
          },
        });

        const version = await tx.documentVersion.create({
          data: {
            documentId: document.id,
            storageBucket: params.storageBucket,
            s3Key: params.s3Key,
            contentHash: params.contentHash,
            versionNumber: 1,
            status: DocumentVersionStatus.QUEUED,
            ingestVersion: 1,
            pipelineVersion: INGEST_PIPELINE_VERSION,
            vectorizationStatus: this.initialVectorizationStatus(),
          },
        });

        const ingestJob = await tx.ingestJob.create({
          data: {
            documentVersionId: version.id,
            status: IngestJobStatus.WAITING,
            correlationId: params.correlationId,
            maxAttempts: this.getMaxAttempts(),
          },
        });

        return { document, version, ingestJob };
      });
    } catch (error) {
      this.logger.error(
        {
          correlation_id: params.correlationId ?? null,
          event: "document_ingest_record_creation_failed",
          kb_id: params.kbId,
          request_id: params.correlationId ?? null,
        },
        error instanceof Error ? error.stack : undefined,
      );
      throw new InternalServerErrorException(
        "Failed to prepare document ingestion",
      );
    }
  }

  private async enqueueIngestJob(params: {
    correlationId?: string;
    document: {
      id: string;
      kbId: string;
      name: string;
      type: string;
    };
    version: {
      id: string;
      ingestVersion: number;
      pipelineVersion: string;
      storageBucket: string;
      s3Key: string;
    };
    ingestJob: {
      id: string;
      maxAttempts: number;
    };
  }) {
    const ingestJob = params satisfies EnqueueableIngestJob;
    const jobPayload = buildIngestQueuePayload(ingestJob);
    const queueOptions = buildIngestQueueOptions(
      params.ingestJob.id,
      params.ingestJob.maxAttempts,
    );

    try {
      await this.ingestQueue.add(INGEST_JOB_NAME, jobPayload, queueOptions);
      this.logger.log(
        {
          correlation_id: params.correlationId ?? null,
          document_id: params.document.id,
          document_version_id: params.version.id,
          event: "ingest_job_enqueued",
          ingest_job_id: params.ingestJob.id,
          job_id: params.ingestJob.id,
          kb_id: params.document.kbId,
          request_id: params.correlationId ?? null,
        },
      );
    } catch (error) {
      const message = "Failed to enqueue ingest job";

      await this.prisma.$transaction(async (tx) => {
        await markQueueEnqueueFailure(tx, {
          documentId: params.document.id,
          documentVersionId: params.version.id,
          ingestJobId: params.ingestJob.id,
          message,
        });
      });

      this.logger.error(
        {
          correlation_id: params.correlationId ?? null,
          document_id: params.document.id,
          document_version_id: params.version.id,
          event: "ingest_job_enqueue_failed",
          ingest_job_id: params.ingestJob.id,
          job_id: params.ingestJob.id,
          kb_id: params.document.kbId,
          request_id: params.correlationId ?? null,
        },
        error instanceof Error ? error.stack : undefined,
      );

      throw new InternalServerErrorException(message);
    }
  }

  private getMaxAttempts() {
    return getConfiguredIngestMaxAttempts(process.env.INGEST_MAX_ATTEMPTS);
  }

  private hashForAudit(value: string) {
    return crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
  }

  private initialVectorizationStatus() {
    return getInitialVectorizationStatus(isOpenAiEmbeddingsAvailable());
  }
}
