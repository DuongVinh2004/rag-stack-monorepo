import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
  ValidationPipe,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import * as request from "supertest";
import { getQueueToken } from "@nestjs/bullmq";
import { DocumentsController } from "../src/documents/documents.controller";
import { DocumentsService } from "../src/documents/documents.service";
import { KnowledgeBasesService } from "../src/knowledge-bases/knowledge-bases.service";
import { AuditService } from "../src/common/audit/audit.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { StorageService } from "../src/common/storage/storage.service";
import { JwtAuthGuard } from "../src/auth/jwt-auth.guard";
import { INGEST_QUEUE_NAME } from "../src/documents/documents.constants";
import { AuthorizationService } from "../src/common/authorization/authorization.service";

const TEST_USER_ID = "11111111-1111-4111-8111-111111111111";
const TEST_KB_ID = "22222222-2222-4222-8222-222222222222";

type DocumentRecord = {
  id: string;
  kbId: string;
  name: string;
  type: string;
  status: string;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  indexedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type DocumentVersionRecord = {
  id: string;
  documentId: string;
  storageBucket: string | null;
  s3Key: string;
  contentHash: string;
  versionNumber: number;
  status: string;
  ingestVersion: number;
  pipelineVersion: string;
  vectorizationStatus: string;
  chunkCount: number;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  indexedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type IngestJobRecord = {
  id: string;
  documentVersionId: string;
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
  retryable: boolean;
  attempts: number;
  maxAttempts: number;
  correlationId: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

class AllowAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    request.user = { id: TEST_USER_ID };
    return true;
  }
}

class FakePrismaService {
  documents: DocumentRecord[] = [];
  versions: DocumentVersionRecord[] = [];
  ingestJobs: IngestJobRecord[] = [];
  audits: any[] = [];
  kbMembers = [{ kbId: TEST_KB_ID, userId: TEST_USER_ID, role: "OWNER" }];
  private sequence = 0;

  document = {
    create: jest.fn(async ({ data }: any) => {
      const record: DocumentRecord = {
        id: this.nextId("doc"),
        kbId: data.kbId,
        name: data.name,
        type: data.type,
        status: data.status,
        lastErrorCode: data.lastErrorCode ?? null,
        lastErrorMessage: data.lastErrorMessage ?? null,
        indexedAt: data.indexedAt ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.documents.push(record);
      return { ...record };
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const record = this.documents.find((item) => item.id === where.id);
      if (!record) {
        throw new Error("Document not found");
      }
      Object.assign(record, data, { updatedAt: new Date() });
      return { ...record };
    }),
    findUnique: jest.fn(async ({ where, include }: any) => {
      const record = this.documents.find((item) => item.id === where.id);
      if (!record) {
        return null;
      }
      if (!include?.versions) {
        return { ...record };
      }

      const versions = this.versions
        .filter((item) => item.documentId === record.id)
        .sort(
          (a, b) =>
            b.versionNumber - a.versionNumber ||
            b.createdAt.getTime() - a.createdAt.getTime(),
        )
        .slice(0, include.versions.take ?? undefined)
        .map((version) => {
          if (!include.versions.include?.ingestJobs) {
            return { ...version };
          }
          const ingestJobs = this.ingestJobs
            .filter((job) => job.documentVersionId === version.id)
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
            .slice(0, include.versions.include.ingestJobs.take ?? undefined)
            .map((job) => ({ ...job }));
          return { ...version, ingestJobs };
        });

      return { ...record, versions };
    }),
    findMany: jest.fn(async ({ where, include }: any) => {
      return this.documents
        .filter((item) => item.kbId === where.kbId)
        .map((item) => {
          if (!include?.versions) {
            return { ...item };
          }

          const versions = this.versions
            .filter((version) => version.documentId === item.id)
            .sort(
              (left, right) =>
                right.versionNumber - left.versionNumber ||
                right.createdAt.getTime() - left.createdAt.getTime(),
            )
            .slice(0, include.versions.take ?? undefined)
            .map((version) => ({
              ...version,
              ingestJobs: include.versions.include?.ingestJobs
                ? this.ingestJobs
                    .filter((job) => job.documentVersionId === version.id)
                    .sort(
                      (left, right) =>
                        right.createdAt.getTime() - left.createdAt.getTime(),
                    )
                    .slice(
                      0,
                      include.versions.include.ingestJobs.take ?? undefined,
                    )
                    .map((job) => ({ ...job }))
                : [],
            }));

          return { ...item, versions };
        });
    }),
  };

  documentVersion = {
    create: jest.fn(async ({ data }: any) => {
      const record: DocumentVersionRecord = {
        id: this.nextId("ver"),
        documentId: data.documentId,
        storageBucket: data.storageBucket ?? null,
        s3Key: data.s3Key,
        contentHash: data.contentHash,
        versionNumber: data.versionNumber ?? 1,
        status: data.status,
        ingestVersion: data.ingestVersion ?? 1,
        pipelineVersion: data.pipelineVersion,
        vectorizationStatus: data.vectorizationStatus,
        chunkCount: data.chunkCount ?? 0,
        lastErrorCode: data.lastErrorCode ?? null,
        lastErrorMessage: data.lastErrorMessage ?? null,
        startedAt: data.startedAt ?? null,
        finishedAt: data.finishedAt ?? null,
        indexedAt: data.indexedAt ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.versions.push(record);
      return { ...record };
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const record = this.versions.find((item) => item.id === where.id);
      if (!record) {
        throw new Error("Document version not found");
      }

      const nextIngestVersion =
        typeof data.ingestVersion?.increment === "number"
          ? record.ingestVersion + data.ingestVersion.increment
          : (data.ingestVersion ?? record.ingestVersion);

      Object.assign(record, {
        ...data,
        ingestVersion: nextIngestVersion,
        updatedAt: new Date(),
      });
      return { ...record };
    }),
  };

  ingestJob = {
    findFirst: jest.fn(async ({ where }: any) => {
      const match = this.ingestJobs
        .filter((item) => {
          if (
            where?.documentVersionId &&
            item.documentVersionId !== where.documentVersionId
          ) {
            return false;
          }
          if (where?.status?.in && !where.status.in.includes(item.status)) {
            return false;
          }
          return true;
        })
        .slice()
        .reverse()[0];
      return match ? { id: match.id } : null;
    }),
    create: jest.fn(async ({ data }: any) => {
      const record: IngestJobRecord = {
        id: this.nextId("job"),
        documentVersionId: data.documentVersionId,
        status: data.status,
        errorCode: data.errorCode ?? null,
        errorMessage: data.errorMessage ?? null,
        retryable: data.retryable ?? true,
        attempts: data.attempts ?? 0,
        maxAttempts: data.maxAttempts ?? 3,
        correlationId: data.correlationId ?? null,
        startedAt: data.startedAt ?? null,
        finishedAt: data.finishedAt ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.ingestJobs.push(record);
      return { ...record };
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const record = this.ingestJobs.find((item) => item.id === where.id);
      if (!record) {
        throw new Error("Ingest job not found");
      }
      Object.assign(record, data, { updatedAt: new Date() });
      return { ...record };
    }),
  };

  kbMember = {
    findUnique: jest.fn(async ({ where }: any) => {
      const match = this.kbMembers.find(
        (item) =>
          item.kbId === where.kbId_userId.kbId &&
          item.userId === where.kbId_userId.userId,
      );
      return match ? { ...match } : null;
    }),
  };

  auditLog = {
    create: jest.fn(async ({ data }: any) => {
      this.audits.push(data);
      return data;
    }),
  };

  user = {
    findUnique: jest.fn(async () => null),
  };

  $transaction = jest.fn(async (fn: any) => fn(this));

  seedIndexedResult(documentId: string) {
    const document = this.documents.find((item) => item.id === documentId);
    const version = this.versions.find(
      (item) => item.documentId === documentId,
    );
    const job = this.ingestJobs.find(
      (item) => item.documentVersionId === version?.id,
    );
    if (!document || !version || !job) {
      throw new Error("Seed target not found");
    }

    document.status = "INDEXED";
    document.indexedAt = new Date();
    document.lastErrorCode = null;
    document.lastErrorMessage = null;

    version.status = "INDEXED";
    version.vectorizationStatus = "DISABLED";
    version.chunkCount = 2;
    version.finishedAt = new Date();
    version.indexedAt = new Date();
    version.lastErrorCode = null;
    version.lastErrorMessage = null;

    job.status = "COMPLETED";
    job.attempts = 1;
    job.finishedAt = new Date();
  }

  seedFailedResult(documentId: string) {
    const document = this.documents.find((item) => item.id === documentId);
    const version = this.versions.find(
      (item) => item.documentId === documentId,
    );
    const job = this.ingestJobs[this.ingestJobs.length - 1];
    if (!document || !version || !job) {
      throw new Error("Seed target not found");
    }

    document.status = "FAILED";
    document.lastErrorCode = "FILE_PARSE_FAILED";
    document.lastErrorMessage = "Failed to extract text from PDF";

    version.status = "FAILED";
    version.vectorizationStatus = "DISABLED";
    version.lastErrorCode = "FILE_PARSE_FAILED";
    version.lastErrorMessage = "Failed to extract text from PDF";
    version.finishedAt = new Date();

    job.status = "FAILED";
    job.errorCode = "FILE_PARSE_FAILED";
    job.errorMessage = "Failed to extract text from PDF";
    job.attempts = 1;
    job.finishedAt = new Date();
  }

  reset() {
    this.documents = [];
    this.versions = [];
    this.ingestJobs = [];
    this.audits = [];
    this.sequence = 0;
  }

  private nextId(_prefix: string) {
    this.sequence += 1;
    return `00000000-0000-4000-8000-${String(this.sequence).padStart(12, "0")}`;
  }
}

describe("Documents API ingestion flow", () => {
  let app: INestApplication;
  let prisma: FakePrismaService;
  const queue = {
    add: jest.fn(async () => ({ id: "queue-1" })),
  };
  const storage = {
    uploadFile: jest.fn(async () => "stored-key"),
  };

  beforeAll(async () => {
    prisma = new FakePrismaService();
    const authorization = {
      assertKnowledgeBaseRole: jest.fn(
        async (user: { id: string }, kbId: string) => {
          const membership = prisma.kbMembers.find(
            (item) => item.kbId === kbId && item.userId === user.id,
          );
          if (!membership) {
            throw new ForbiddenException("Knowledge base access denied");
          }
          return { kb: { id: kbId }, membershipRole: membership.role };
        },
      ),
      assertDocumentRead: jest.fn(
        async (_user: { id: string }, documentId: string, include?: any) => {
          const record = prisma.documents.find(
            (item) => item.id === documentId,
          );
          if (!record) {
            throw new NotFoundException("Document not found");
          }

          const versions = include?.versions
            ? prisma.versions
                .filter((item) => item.documentId === record.id)
                .sort(
                  (left, right) =>
                    right.versionNumber - left.versionNumber ||
                    right.createdAt.getTime() - left.createdAt.getTime(),
                )
                .slice(0, include.versions.take ?? undefined)
                .map((version) => ({
                  ...version,
                  ingestJobs: include.versions.include?.ingestJobs
                    ? prisma.ingestJobs
                        .filter((job) => job.documentVersionId === version.id)
                        .sort(
                          (left, right) =>
                            right.createdAt.getTime() -
                            left.createdAt.getTime(),
                        )
                        .slice(
                          0,
                          include.versions.include.ingestJobs.take ?? undefined,
                        )
                        .map((job) => ({ ...job }))
                    : undefined,
                }))
            : undefined;

          return {
            ...record,
            ...(versions ? { versions } : {}),
          };
        },
      ),
      buildDocumentReadWhere: jest.fn(
        (_user: { id: string }, documentId?: string) =>
          documentId ? { id: documentId } : {},
      ),
      isAdmin: jest.fn(() => false),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [DocumentsController],
      providers: [
        DocumentsService,
        KnowledgeBasesService,
        AuditService,
        { provide: AuthorizationService, useValue: authorization },
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storage },
        { provide: getQueueToken(INGEST_QUEUE_NAME), useValue: queue },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(AllowAuthGuard)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    prisma.reset();
    queue.add.mockClear();
    storage.uploadFile.mockClear();
  });

  it("uploads a document, queues ingestion, and shows indexed status after worker completion", async () => {
    const uploadResponse = await request(app.getHttpServer())
      .post("/api/v1/documents/upload")
      .field("kbId", TEST_KB_ID)
      .field("name", "Runbook")
      .attach("file", Buffer.from("runbook text"), {
        filename: "runbook.txt",
        contentType: "text/plain",
      });

    expect(uploadResponse.status).toBe(201);

    expect(storage.uploadFile).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(uploadResponse.body.status).toBe("QUEUED");
    expect(uploadResponse.body.latestVersion.status).toBe("QUEUED");
    expect(uploadResponse.body.latestVersion.latestIngestJob.status).toBe(
      "WAITING",
    );

    prisma.seedIndexedResult(uploadResponse.body.id);

    const detailResponse = await request(app.getHttpServer())
      .get(`/api/v1/documents/${uploadResponse.body.id}`)
      .expect(200);

    expect(detailResponse.body.status).toBe("INDEXED");
    expect(detailResponse.body.chunkCount).toBe(2);
    expect(detailResponse.body.latestVersion.latestIngestJob.status).toBe(
      "COMPLETED",
    );
    expect(detailResponse.body.embeddingsEnabled).toBe(false);

    const listResponse = await request(app.getHttpServer())
      .get(`/api/v1/documents?kbId=${TEST_KB_ID}`)
      .expect(200);

    expect(listResponse.body).toHaveLength(1);
    expect(listResponse.body[0]).toMatchObject({
      id: uploadResponse.body.id,
      kbId: TEST_KB_ID,
      status: "INDEXED",
    });
  });

  it("requeues the latest version and exposes failed worker state in document detail", async () => {
    const uploadResponse = await request(app.getHttpServer())
      .post("/api/v1/documents/upload")
      .field("kbId", TEST_KB_ID)
      .field("name", "PDF Manual")
      .attach("file", Buffer.from("%PDF-1.4 fake"), {
        filename: "manual.pdf",
        contentType: "application/pdf",
      });

    expect(uploadResponse.status).toBe(201);

    prisma.seedIndexedResult(uploadResponse.body.id);

    const reindexResponse = await request(app.getHttpServer())
      .post(`/api/v1/documents/${uploadResponse.body.id}/reindex`)
      .expect(201);

    expect(queue.add).toHaveBeenCalledTimes(2);
    expect(reindexResponse.body.latestVersion.ingestVersion).toBe(2);
    expect(reindexResponse.body.latestVersion.latestIngestJob.status).toBe(
      "WAITING",
    );

    prisma.seedFailedResult(uploadResponse.body.id);

    const failedDetail = await request(app.getHttpServer())
      .get(`/api/v1/documents/${uploadResponse.body.id}`)
      .expect(200);

    expect(failedDetail.body.status).toBe("FAILED");
    expect(failedDetail.body.latestVersion.latestIngestJob.status).toBe(
      "FAILED",
    );
    expect(failedDetail.body.latestVersion.latestIngestJob.errorCode).toBe(
      "FILE_PARSE_FAILED",
    );
  });

  it("rejects reindex when the latest version already has a queued ingest job", async () => {
    const uploadResponse = await request(app.getHttpServer())
      .post("/api/v1/documents/upload")
      .field("kbId", TEST_KB_ID)
      .field("name", "Queued Document")
      .attach("file", Buffer.from("runbook text"), {
        filename: "runbook.txt",
        contentType: "text/plain",
      })
      .expect(201);

    const reindexResponse = await request(app.getHttpServer())
      .post(`/api/v1/documents/${uploadResponse.body.id}/reindex`)
      .expect(400);

    expect(reindexResponse.body.message).toContain("active ingest job");
    expect(queue.add).toHaveBeenCalledTimes(1);
  });

  it("rejects uploads when file content does not match the declared type", async () => {
    const response = await request(app.getHttpServer())
      .post("/api/v1/documents/upload")
      .field("kbId", TEST_KB_ID)
      .field("name", "Mismatched File")
      .attach("file", Buffer.from("%PDF-1.4 fake"), {
        filename: "mismatch.txt",
        contentType: "text/plain",
      });

    expect(response.status).toBe(400);
    expect(storage.uploadFile).not.toHaveBeenCalled();
  });

  it("sanitizes storage filenames before uploading to object storage", async () => {
    const response = await request(app.getHttpServer())
      .post("/api/v1/documents/upload")
      .field("kbId", TEST_KB_ID)
      .field("name", "Runbook")
      .attach("file", Buffer.from("runbook text"), {
        filename: "../../team runbook.txt",
        contentType: "text/plain",
      });

    expect(response.status).toBe(201);
    expect(storage.uploadFile).toHaveBeenCalledTimes(1);
    const uploadedKey = (storage.uploadFile as jest.Mock).mock
      .calls[0][1] as string;
    expect(uploadedKey).not.toContain("..");
    expect(uploadedKey).toContain("team-runbook.txt");
  });
});
