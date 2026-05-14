import {
  DocumentStatus,
  DocumentVersionStatus,
  IngestJobStatus,
  Prisma,
  VectorizationStatus,
} from "@prisma/client";
import { JobsOptions } from "bullmq";
import {
  DEFAULT_INGEST_BACKOFF_MS,
  DEFAULT_INGEST_MAX_ATTEMPTS,
} from "./documents.constants";

type QueueJobDocument = {
  id: string;
  kbId: string;
  name: string;
  type: string;
};

type QueueJobVersion = {
  id: string;
  ingestVersion: number;
  pipelineVersion: string;
  storageBucket: string;
  s3Key: string;
};

type QueueJobRecord = {
  id: string;
  maxAttempts: number;
};

export type EnqueueableIngestJob = {
  correlationId?: string;
  document: QueueJobDocument;
  version: QueueJobVersion;
  ingestJob: QueueJobRecord;
};

export function getInitialVectorizationStatus(openAiConfigured: boolean) {
  return openAiConfigured
    ? VectorizationStatus.PENDING
    : VectorizationStatus.DISABLED;
}

export function getConfiguredIngestMaxAttempts(rawValue?: string) {
  const raw = Number.parseInt(rawValue || "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_INGEST_MAX_ATTEMPTS;
}

export function buildIngestQueuePayload(job: EnqueueableIngestJob) {
  return {
    bucket: job.version.storageBucket,
    correlationId: job.correlationId,
    documentId: job.document.id,
    documentVersionId: job.version.id,
    ingestJobId: job.ingestJob.id,
    ingestVersion: job.version.ingestVersion,
    kbId: job.document.kbId,
    mimeType: job.document.type,
    pipelineVersion: job.version.pipelineVersion,
    s3Key: job.version.s3Key,
    sourceTitle: job.document.name,
  };
}

export function buildIngestQueueOptions(
  ingestJobId: string,
  maxAttempts: number,
): JobsOptions {
  return {
    attempts: maxAttempts,
    backoff: {
      type: "exponential",
      delay: DEFAULT_INGEST_BACKOFF_MS,
    },
    jobId: ingestJobId,
    removeOnComplete: {
      age: 3600,
      count: 1000,
    },
    removeOnFail: {
      age: 86400,
      count: 5000,
    },
  };
}

export async function markQueueEnqueueFailure(
  tx: Prisma.TransactionClient,
  params: {
    documentId: string;
    documentVersionId: string;
    ingestJobId: string;
    message: string;
    finishedAt?: Date;
  },
) {
  const finishedAt = params.finishedAt ?? new Date();

  await tx.ingestJob.update({
    where: { id: params.ingestJobId },
    data: {
      status: IngestJobStatus.FAILED,
      errorCode: "QUEUE_ENQUEUE_FAILED",
      errorMessage: params.message,
      retryable: true,
      finishedAt,
    },
  });

  await tx.documentVersion.update({
    where: { id: params.documentVersionId },
    data: {
      status: DocumentVersionStatus.FAILED,
      lastErrorCode: "QUEUE_ENQUEUE_FAILED",
      lastErrorMessage: params.message,
      finishedAt,
    },
  });

  await tx.document.update({
    where: { id: params.documentId },
    data: {
      status: DocumentStatus.FAILED,
      lastErrorCode: "QUEUE_ENQUEUE_FAILED",
      lastErrorMessage: params.message,
    },
  });
}
