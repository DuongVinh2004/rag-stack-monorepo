import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  INestApplication,
  ValidationPipe,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as request from "supertest";
import { getQueueToken } from "@nestjs/bullmq";
import { OpsController } from "../src/ops/ops.controller";
import { OpsService } from "../src/ops/ops.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { AuditService } from "../src/common/audit/audit.service";
import { MetricsService } from "../src/common/observability/metrics.service";
import { TracingService } from "../src/common/observability/tracing.service";
import { JwtAuthGuard } from "../src/auth/jwt-auth.guard";
import { RolesGuard } from "../src/common/guards/roles.guard";
import { INGEST_QUEUE_NAME } from "../src/documents/documents.constants";
import { AuthorizationService } from "../src/common/authorization/authorization.service";

const FAILED_JOB_ID = "11111111-1111-4111-8111-111111111111";
const VERSION_ID = "22222222-2222-4222-8222-222222222222";
const DOCUMENT_ID = "33333333-3333-4333-8333-333333333333";
const KB_ID = "44444444-4444-4444-8444-444444444444";

class HeaderAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    const isAdmin = req.headers["x-admin"] === "true";
    req.user = {
      id: "admin-user",
      UserRole: isAdmin ? [{ role: { name: "SUPER_ADMIN" } }] : [],
    };
    return true;
  }
}

class FakePrismaService {
  audits: any[] = [];
  documents = [
    {
      id: DOCUMENT_ID,
      kbId: KB_ID,
      name: "Worker Runbook",
      type: "text/plain",
      status: "FAILED",
      lastErrorCode: "FILE_PARSE_FAILED",
      lastErrorMessage: "Failed to parse",
    },
  ];
  versions = [
    {
      id: VERSION_ID,
      documentId: DOCUMENT_ID,
      storageBucket: "knowledge-base-bucket",
      s3Key: "kb-1/runbook.txt",
      ingestVersion: 1,
      pipelineVersion: "phase2.v1",
      status: "FAILED",
      vectorizationStatus: "DISABLED",
      lastErrorCode: "FILE_PARSE_FAILED",
      lastErrorMessage: "Failed to parse",
      document: null as any,
    },
  ];
  ingestJobs = [
    {
      id: FAILED_JOB_ID,
      documentVersionId: VERSION_ID,
      status: "FAILED",
      errorCode: "FILE_PARSE_FAILED",
      errorMessage: "Failed to parse",
      retryable: true,
      attempts: 3,
      maxAttempts: 3,
      correlationId: "corr-old",
      documentVersion: null as any,
    },
  ];
  sequence = 10;

  constructor() {
    this.versions[0].document = this.documents[0];
    this.ingestJobs[0].documentVersion = this.versions[0];
  }

  ingestJob = {
    findMany: jest.fn(async () => this.ingestJobs.map((job) => ({ ...job }))),
    findUnique: jest.fn(async ({ where }: any) => {
      const found = this.ingestJobs.find((job) => job.id === where.id);
      return found
        ? {
            ...found,
            documentVersion: {
              ...found.documentVersion,
              document: { ...found.documentVersion.document },
            },
          }
        : null;
    }),
    findFirst: jest.fn(async ({ where }: any) => {
      const matches = this.ingestJobs
        .filter((job) => {
          if (
            where?.documentVersionId &&
            job.documentVersionId !== where.documentVersionId
          ) {
            return false;
          }
          if (where?.status?.in && !where.status.in.includes(job.status)) {
            return false;
          }
          return true;
        })
        .slice()
        .reverse();
      return matches[0]
        ? { id: matches[0].id, status: matches[0].status }
        : null;
    }),
    create: jest.fn(async ({ data }: any) => {
      const created = {
        id: `55555555-5555-4555-8555-${String(this.sequence).padStart(12, "0")}`,
        documentVersionId: data.documentVersionId,
        status: data.status,
        errorCode: null,
        errorMessage: null,
        retryable: data.retryable ?? true,
        attempts: data.attempts ?? 0,
        maxAttempts: data.maxAttempts,
        correlationId: data.correlationId ?? null,
      };
      this.sequence += 1;
      this.ingestJobs.push({ ...created, documentVersion: this.versions[0] });
      return created;
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const found = this.ingestJobs.find((job) => job.id === where.id);
      Object.assign(found, data);
      return { ...found };
    }),
    count: jest.fn(async () => 1),
  };

  documentVersion = {
    update: jest.fn(async ({ where, data }: any) => {
      const found = this.versions.find((version) => version.id === where.id)!;
      found.ingestVersion =
        typeof data.ingestVersion?.increment === "number"
          ? found.ingestVersion + data.ingestVersion.increment
          : found.ingestVersion;
      Object.assign(found, { ...data, document: found.document });
      return { ...found };
    }),
  };

  document = {
    update: jest.fn(async ({ where, data }: any) => {
      const found = this.documents.find(
        (document) => document.id === where.id,
      )!;
      Object.assign(found, data);
      return { ...found };
    }),
  };

  evalRun = {
    findFirst: jest.fn(async () => null),
  };

  auditLog = {
    create: jest.fn(async ({ data }: any) => {
      this.audits.push(data);
      return data;
    }),
  };

  $queryRaw = jest.fn(async () => [{ averageMs: 150 }]);
  $transaction = jest.fn(async (callback: any) => callback(this));
}

describe("Ops API", () => {
  let app: INestApplication;
  let prisma: FakePrismaService;
  const queue = {
    add: jest.fn(async () => ({ id: "queue-1" })),
  };

  beforeAll(async () => {
    prisma = new FakePrismaService();
    const authorization = {
      hasAnySystemRole: jest.fn(
        (
          user: { UserRole?: Array<{ role?: { name?: string } }> },
          allowedRoles: string[],
        ) =>
          Boolean(
            user.UserRole?.some((entry) =>
              allowedRoles.includes(entry.role?.name ?? ""),
            ),
          ),
      ),
      assertOpsAccess: jest.fn(
        (user: { UserRole?: Array<{ role?: { name?: string } }> }) => {
          const isOperator = authorization.hasAnySystemRole(user, [
            "SUPER_ADMIN",
            "OPERATOR",
          ]);
          if (!isOperator) {
            throw new ForbiddenException("Operator access required");
          }
        },
      ),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [OpsController],
      providers: [
        OpsService,
        AuditService,
        RolesGuard,
        { provide: AuthorizationService, useValue: authorization },
        { provide: PrismaService, useValue: prisma },
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
        { provide: getQueueToken(INGEST_QUEUE_NAME), useValue: queue },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(HeaderAuthGuard)
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

  it("blocks non-admin users from operator endpoints", async () => {
    await request(app.getHttpServer())
      .get("/api/v1/ops/jobs/failed")
      .expect(403);
  });

  it("lists failed jobs for admins", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/v1/ops/jobs/failed")
      .set("x-admin", "true")
      .expect(200);

    expect(response.body).toHaveLength(1);
    expect(response.body[0].id).toBe(FAILED_JOB_ID);
  });

  it("retries a failed ingest job for admins", async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/ops/jobs/${FAILED_JOB_ID}/retry`)
      .set("x-admin", "true")
      .expect(201);

    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(response.body.retriedFromJobId).toBe(FAILED_JOB_ID);
    expect(response.body.status).toBe("WAITING");
    expect(prisma.audits).toHaveLength(1);
  });

  it("blocks retrying a stale failed job once a newer job exists", async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/ops/jobs/${FAILED_JOB_ID}/retry`)
      .set("x-admin", "true")
      .expect(400);
  });
});
