import {
  buildIngestQueueOptions,
  buildIngestQueuePayload,
  getConfiguredIngestMaxAttempts,
  getInitialVectorizationStatus,
} from "./ingest-job.helpers";

describe("ingest job helpers", () => {
  it("builds the ingest queue payload with the expected worker contract", () => {
    expect(
      buildIngestQueuePayload({
        correlationId: "corr-1",
        document: {
          id: "doc-1",
          kbId: "kb-1",
          name: "Support Runbook",
          type: "text/plain",
        },
        version: {
          id: "ver-1",
          ingestVersion: 2,
          pipelineVersion: "phase2.v1",
          storageBucket: "knowledge-base-bucket",
          s3Key: "kb-1/runbook.txt",
        },
        ingestJob: {
          id: "job-1",
          maxAttempts: 3,
        },
      }),
    ).toEqual({
      bucket: "knowledge-base-bucket",
      correlationId: "corr-1",
      documentId: "doc-1",
      documentVersionId: "ver-1",
      ingestJobId: "job-1",
      ingestVersion: 2,
      kbId: "kb-1",
      mimeType: "text/plain",
      pipelineVersion: "phase2.v1",
      s3Key: "kb-1/runbook.txt",
      sourceTitle: "Support Runbook",
    });
  });

  it("builds stable queue retry options", () => {
    expect(buildIngestQueueOptions("job-1", 5)).toMatchObject({
      attempts: 5,
      backoff: {
        type: "exponential",
        delay: 5000,
      },
      jobId: "job-1",
      removeOnComplete: {
        age: 3600,
        count: 1000,
      },
      removeOnFail: {
        age: 86400,
        count: 5000,
      },
    });
  });

  it("keeps vectorization status and attempt fallback behavior unchanged", () => {
    expect(getInitialVectorizationStatus(true)).toBe("PENDING");
    expect(getInitialVectorizationStatus(false)).toBe("DISABLED");
    expect(getConfiguredIngestMaxAttempts("4")).toBe(4);
    expect(getConfiguredIngestMaxAttempts("")).toBe(3);
    expect(getConfiguredIngestMaxAttempts("0")).toBe(3);
  });
});
