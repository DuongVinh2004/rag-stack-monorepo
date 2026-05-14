import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { DocumentsService } from "./documents.service";

describe("DocumentsService", () => {
  const createService = () => {
    const prisma = {} as any;
    const kbService = {
      assertKbAccess: jest.fn(),
    } as any;
    const authorization = {
      assertDocumentRead: jest.fn(),
      buildDocumentReadWhere: jest.fn().mockReturnValue({}),
    } as any;
    const storageService = {
      uploadFile: jest.fn(),
    } as any;
    const audit = {
      logAction: jest.fn(),
    } as any;
    const ingestQueue = {
      add: jest.fn(),
    } as any;

    const service = new DocumentsService(
      prisma,
      kbService,
      authorization,
      storageService,
      audit,
      ingestQueue,
    );

    jest.spyOn(service as any, "createDocumentRecords").mockResolvedValue({
      document: {
        id: "doc-1",
        kbId: "kb-1",
        name: "Guide",
        type: "text/plain",
      },
      version: {
        id: "ver-1",
        ingestVersion: 1,
        pipelineVersion: "phase2.v1",
        storageBucket: "knowledge-base-bucket",
        s3Key: "kb-1/hash-guide.txt",
      },
      ingestJob: {
        id: "job-1",
        maxAttempts: 3,
      },
    });
    jest.spyOn(service as any, "enqueueIngestJob").mockResolvedValue(undefined);
    jest.spyOn(service, "findOne").mockResolvedValue({
      id: "doc-1",
      kbId: "kb-1",
    } as any);

    return {
      prisma,
      kbService,
      authorization,
      storageService,
      audit,
      service,
    };
  };

  const file = {
    originalname: "guide.txt",
    mimetype: "text/plain",
    size: 32,
    buffer: Buffer.from("reset the worker before retrying"),
  } as Express.Multer.File;

  it("blocks viewers from uploading documents", async () => {
    const { service, kbService, storageService } = createService();
    kbService.assertKbAccess.mockRejectedValue(
      new ForbiddenException("Knowledge base access denied"),
    );

    await expect(
      service.uploadDocument({ id: "user-1" }, "kb-1", "Guide", file),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(storageService.uploadFile).not.toHaveBeenCalled();
  });

  it("allows editors to upload in their own KB", async () => {
    const { service, kbService, storageService, audit } = createService();
    kbService.assertKbAccess.mockResolvedValue("EDITOR");

    await service.uploadDocument(
      { id: "user-1" },
      "kb-1",
      "Guide",
      file,
      "corr-1",
    );

    expect(kbService.assertKbAccess).toHaveBeenCalledWith(
      "kb-1",
      { id: "user-1" },
      expect.arrayContaining(["OWNER", "EDITOR"]),
    );
    expect(storageService.uploadFile).toHaveBeenCalled();
    expect(audit.logAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: "user-1",
        action: "DOCUMENT_UPLOAD",
        kbId: "kb-1",
      }),
    );
  });

  it("hides other KBs when an editor uploads outside their own scope", async () => {
    const { service, kbService, storageService } = createService();
    kbService.assertKbAccess.mockRejectedValue(
      new NotFoundException("Knowledge base not found"),
    );

    await expect(
      service.uploadDocument({ id: "user-1" }, "kb-2", "Guide", file),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(storageService.uploadFile).not.toHaveBeenCalled();
  });
});
