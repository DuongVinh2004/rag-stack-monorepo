import { LocalGroundedAnswerService } from "./local-grounded-answer.service";
import { RetrievalCandidate } from "./chat.types";

const candidate = (
  overrides: Partial<RetrievalCandidate>,
): RetrievalCandidate => ({
  chunkId: overrides.chunkId ?? "chunk-1",
  documentId: overrides.documentId ?? "doc-1",
  documentTitle: overrides.documentTitle ?? "Runbook",
  documentVersionId: overrides.documentVersionId ?? "ver-1",
  kbId: overrides.kbId ?? "kb-1",
  chunkNo: overrides.chunkNo ?? 1,
  content: overrides.content ?? "Check Redis health first.",
  searchText: overrides.searchText ?? "check redis health first",
  checksum: overrides.checksum ?? "sum-1",
  sectionTitle: overrides.sectionTitle ?? "Queue backlog guidance",
  pageNumber: overrides.pageNumber ?? null,
  sourceTitle: overrides.sourceTitle ?? "Operations Runbook",
  language: overrides.language ?? "en",
  metadataJson: overrides.metadataJson ?? null,
  semanticScore: overrides.semanticScore ?? 0,
  lexicalScore: overrides.lexicalScore ?? 0.5,
  metadataScore: overrides.metadataScore ?? 0,
  recencyScore: overrides.recencyScore ?? 0,
  structuralScore: overrides.structuralScore ?? 0.2,
  hybridScore: overrides.hybridScore ?? 0.1,
  semanticRank: overrides.semanticRank ?? null,
  lexicalRank: overrides.lexicalRank ?? 1,
  indexedAt: overrides.indexedAt ?? null,
  debug: overrides.debug ?? {
    retrievedBy: ["lexical"],
    rawSemanticDistance: null,
    rawSemanticSimilarity: null,
    rawLexicalScore: 0.3,
    lexicalTokenCoverage: 0.5,
    lexicalPhraseCoverage: 0,
    metadataSignals: [],
    structuralSignals: [],
    selectionReason: "test",
    rankBeforeDedup: null,
    rankAfterDedup: null,
    dedupReason: null,
  },
});

describe("LocalGroundedAnswerService", () => {
  it("treats close prefix variants as covered so single-source answers stay focused", async () => {
    const citations = {
      buildSnippet: jest.fn(({ content }) => content),
    } as any;

    const service = new LocalGroundedAnswerService(citations);

    const result = await service.createGroundedAnswer({
      question: "How do I reset the worker?",
      normalizedQuery: "how do i reset the worker",
      selectedChunks: [
        candidate({
          chunkId: "chunk-worker",
          content:
            "Resetting the worker: restart the worker process before retrying the failed job.",
          searchText:
            "resetting the worker restart the worker process before retrying the failed job",
          hybridScore: 0.114566,
        }),
        candidate({
          chunkId: "chunk-account",
          content:
            "Customer account reset: clear the active session and issue a password reset link.",
          searchText:
            "customer account reset clear the active session and issue a password reset link",
          hybridScore: 0.111028,
          lexicalRank: 2,
        }),
      ],
    });

    expect(result.answer.usedChunkIds).toEqual(["chunk-worker"]);
    expect(result.answer.answer).toContain("restart the worker process");
    expect(result.answer.answer).not.toContain("password reset link");
  });

  it("keeps a second close-scoring chunk when it adds coverage for lexical-only answers", async () => {
    const citations = {
      buildSnippet: jest.fn(({ content }) => content),
    } as any;

    const service = new LocalGroundedAnswerService(citations);

    const result = await service.createGroundedAnswer({
      question:
        "Before escalating a stuck ingest queue, what should I verify first and what evidence should I collect?",
      normalizedQuery:
        "before escalating a stuck ingest queue what should i verify first and what evidence should i collect",
      selectedChunks: [
        candidate({
          chunkId: "chunk-verify",
          content:
            "Check Redis health first, then confirm the worker is consuming from the ingest_jobs queue.",
          searchText:
            "check redis health first then confirm the worker is consuming from the ingest_jobs queue",
          hybridScore: 0.10775,
        }),
        candidate({
          chunkId: "chunk-evidence",
          content:
            "Before escalating an ingestion issue, collect the ingest job id, document id, document version id, correlation id, and worker logs.",
          searchText:
            "before escalating an ingestion issue collect the ingest job id document id document version id correlation id and worker logs",
          hybridScore: 0.097056,
          lexicalRank: 2,
        }),
        candidate({
          chunkId: "chunk-low",
          content: "Reset the worker before retrying the failed job.",
          searchText: "reset the worker before retrying the failed job",
          hybridScore: 0.032389,
          lexicalRank: 3,
        }),
      ],
    });

    expect(result.answer.status).toBe("grounded");
    expect(result.answer.usedChunkIds).toEqual(["chunk-verify", "chunk-evidence"]);
    expect(result.answer.answer).toContain("Check Redis health first");
    expect(result.answer.answer).toContain("collect the ingest job id");
  });
});
