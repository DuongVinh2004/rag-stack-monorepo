import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { OpsService } from "./ops.service";

const makeAuthorization = (allowOpsAccess = true) => ({
  assertOpsAccess: jest.fn(() => {
    if (!allowOpsAccess) {
      throw new ForbiddenException("Operator access required");
    }
  }),
});

const makeMetrics = () => ({
  increment: jest.fn(),
  recordDuration: jest.fn(),
  snapshot: jest.fn().mockReturnValue({
    counters: {},
    histograms: {},
    capturedAt: new Date().toISOString(),
  }),
});

const makeTracing = () => ({
  startSpan: jest.fn().mockReturnValue({
    setAttribute: jest.fn(),
    recordException: jest.fn(),
    end: jest.fn(),
  }),
});

const makeQueue = () => ({ add: jest.fn() });

const makeAudit = () => ({ logAction: jest.fn() });

const makePrisma = () => ({
  ingestJob: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    count: jest.fn().mockResolvedValue(0),
  },
  documentVersion: {
    update: jest.fn(),
  },
  document: {
    update: jest.fn(),
  },
  evalRun: {
    findFirst: jest.fn().mockResolvedValue(null),
  },
  $queryRaw: jest.fn().mockResolvedValue([{ averageMs: null }]),
  $transaction: jest.fn(async (fn: (tx: any) => any) => fn({
    documentVersion: { update: jest.fn() },
    document: { update: jest.fn() },
    ingestJob: { create: jest.fn(), update: jest.fn() },
  })),
});

const createService = (overrides: {
  allowOpsAccess?: boolean;
  prisma?: ReturnType<typeof makePrisma>;
} = {}) => {
  const prisma = overrides.prisma ?? makePrisma();
  const authorization = makeAuthorization(overrides.allowOpsAccess ?? true);
  const metrics = makeMetrics();
  const tracing = makeTracing();
  const queue = makeQueue();
  const audit = makeAudit();

  const service = new OpsService(
    prisma as any,
    audit as any,
    authorization as any,
    metrics as any,
    tracing as any,
    queue as any,
  );

  return { service, prisma, authorization, metrics, tracing, queue, audit };
};

describe("OpsService", () => {
  describe("listFailedJobs", () => {
    it("rejects non-operators at the service layer", async () => {
      const { service } = createService({ allowOpsAccess: false });

      await expect(
        service.listFailedJobs({ id: "user-1" }, 10),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("passes limit through to prisma bounded to [1, 200]", async () => {
      const prisma = makePrisma();
      prisma.ingestJob.findMany.mockResolvedValue([]);
      const { service } = createService({ prisma });

      await service.listFailedJobs({ id: "user-1" }, 999);

      expect(prisma.ingestJob.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 200 }),
      );
    });

    it("clamps limit of 0 up to 1", async () => {
      const prisma = makePrisma();
      prisma.ingestJob.findMany.mockResolvedValue([]);
      const { service } = createService({ prisma });

      await service.listFailedJobs({ id: "user-1" }, 0);

      expect(prisma.ingestJob.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 1 }),
      );
    });
  });

  describe("retryIngestJob", () => {
    it("throws NotFoundException when job does not exist", async () => {
      const prisma = makePrisma();
      prisma.ingestJob.findUnique.mockResolvedValue(null);
      const { service } = createService({ prisma });

      await expect(
        service.retryIngestJob("missing-job-id", { id: "user-1" }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("throws BadRequestException when job is not in FAILED or DEAD_LETTER state", async () => {
      const prisma = makePrisma();
      prisma.ingestJob.findUnique.mockResolvedValue({
        id: "job-1",
        status: "WAITING",
        documentVersionId: "ver-1",
        maxAttempts: 3,
        documentVersion: { document: { id: "doc-1", kbId: "kb-1", name: "test.pdf", type: "application/pdf" } },
      });
      prisma.ingestJob.findFirst.mockResolvedValue({ id: "job-1", status: "WAITING" });
      const { service } = createService({ prisma });

      await expect(
        service.retryIngestJob("job-1", { id: "user-1" }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("throws BadRequestException when job-1 is not the latest for its version", async () => {
      const prisma = makePrisma();
      prisma.ingestJob.findUnique.mockResolvedValue({
        id: "job-1",
        status: "FAILED",
        documentVersionId: "ver-1",
        maxAttempts: 3,
        documentVersion: { document: { id: "doc-1", kbId: "kb-1", name: "test.pdf", type: "application/pdf" } },
      });
      // findFirst returns a newer job (id != job-1)
      prisma.ingestJob.findFirst.mockResolvedValue({ id: "job-2", status: "COMPLETED" });
      const { service } = createService({ prisma });

      await expect(
        service.retryIngestJob("job-1", { id: "user-1" }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe("getMetricsSnapshot", () => {
    it("returns snapshot with ingestion counters and null evals when no run exists", async () => {
      const prisma = makePrisma();
      prisma.ingestJob.count.mockResolvedValue(0);
      prisma.evalRun.findFirst.mockResolvedValue(null);
      prisma.$queryRaw.mockResolvedValue([{ averageMs: null }]);
      const { service } = createService({ prisma });

      const result = await service.getMetricsSnapshot({ id: "admin-1" });

      expect(result.evals).toBeNull();
      expect(result.ingestion).toMatchObject({
        failedJobs: 0,
        waitingJobs: 0,
        activeJobs: 0,
        completedJobs: 0,
        averageDurationMs: 0,
      });
      expect(result.capturedAt).toBeDefined();
    });

    it("returns latest eval run summary when a completed run exists", async () => {
      const prisma = makePrisma();
      prisma.ingestJob.count.mockResolvedValue(0);
      const latestRun = {
        id: "run-1",
        summaryJson: { passRate: 0.9 },
        startedAt: new Date(),
      };
      prisma.evalRun.findFirst.mockResolvedValue(latestRun);
      prisma.$queryRaw.mockResolvedValue([{ averageMs: 1234 }]);
      const { service } = createService({ prisma });

      const result = await service.getMetricsSnapshot({ id: "admin-1" });

      expect(result.evals).not.toBeNull();
      expect(result.evals?.latestRunId).toBe("run-1");
    });

    it("rejects non-operators", async () => {
      const { service } = createService({ allowOpsAccess: false });

      await expect(
        service.getMetricsSnapshot({ id: "user-1" }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
