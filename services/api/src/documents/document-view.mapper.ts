import { Prisma, VectorizationStatus } from "@prisma/client";

export type DocumentDetailRecord = Prisma.DocumentGetPayload<{
  include: {
    versions: {
      orderBy: [{ versionNumber: "desc" }, { createdAt: "desc" }];
      take: 1;
      include: {
        ingestJobs: {
          orderBy: [{ createdAt: "desc" }];
          take: 5;
        };
      };
    };
  };
}>;

export type DocumentListRecord = Prisma.DocumentGetPayload<{
  include: {
    versions: {
      orderBy: [{ versionNumber: "desc" }, { createdAt: "desc" }];
      take: 1;
      include: {
        ingestJobs: {
          orderBy: [{ createdAt: "desc" }];
          take: 1;
        };
      };
    };
  };
}>;

export function toDocumentDetailView(
  doc: DocumentDetailRecord,
  embeddingsConfigured: boolean,
) {
  const latestVersion = doc.versions[0] ?? null;
  const latestIngestJob = latestVersion?.ingestJobs[0] ?? null;

  return {
    ...buildDocumentBaseView(doc, latestVersion, latestIngestJob),
    chunkCount: latestVersion?.chunkCount ?? 0,
    embeddingsEnabled:
      latestVersion?.vectorizationStatus === VectorizationStatus.DISABLED
        ? false
        : embeddingsConfigured,
  };
}

export function toDocumentListItemView(doc: DocumentListRecord) {
  const latestVersion = doc.versions[0] ?? null;
  const latestIngestJob = latestVersion?.ingestJobs[0] ?? null;

  return {
    ...buildDocumentBaseView(doc, latestVersion, latestIngestJob),
    chunkCount: latestVersion?.chunkCount ?? 0,
  };
}

function buildDocumentBaseView(
  doc: Pick<
    DocumentDetailRecord,
    | "id"
    | "kbId"
    | "name"
    | "type"
    | "status"
    | "indexedAt"
    | "lastErrorCode"
    | "lastErrorMessage"
    | "createdAt"
    | "updatedAt"
  >,
  latestVersion: DocumentDetailRecord["versions"][number] | null,
  latestIngestJob:
    | DocumentDetailRecord["versions"][number]["ingestJobs"][number]
    | null,
) {
  return {
    id: doc.id,
    kbId: doc.kbId,
    name: doc.name,
    type: doc.type,
    status: doc.status,
    indexedAt: doc.indexedAt,
    lastErrorCode: doc.lastErrorCode,
    lastErrorMessage: doc.lastErrorMessage,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    latestVersion: latestVersion
      ? {
          id: latestVersion.id,
          versionNumber: latestVersion.versionNumber,
          status: latestVersion.status,
          ingestVersion: latestVersion.ingestVersion,
          pipelineVersion: latestVersion.pipelineVersion,
          vectorizationStatus: latestVersion.vectorizationStatus,
          chunkCount: latestVersion.chunkCount,
          indexedAt: latestVersion.indexedAt,
          startedAt: latestVersion.startedAt,
          finishedAt: latestVersion.finishedAt,
          lastErrorCode: latestVersion.lastErrorCode,
          lastErrorMessage: latestVersion.lastErrorMessage,
          latestIngestJob: latestIngestJob
            ? {
                id: latestIngestJob.id,
                status: latestIngestJob.status,
                attempts: latestIngestJob.attempts,
                maxAttempts: latestIngestJob.maxAttempts,
                retryable: latestIngestJob.retryable,
                errorCode: latestIngestJob.errorCode,
                errorMessage: latestIngestJob.errorMessage,
                correlationId: latestIngestJob.correlationId,
                startedAt: latestIngestJob.startedAt,
                finishedAt: latestIngestJob.finishedAt,
                createdAt: latestIngestJob.createdAt,
              }
            : null,
        }
      : null,
  };
}
