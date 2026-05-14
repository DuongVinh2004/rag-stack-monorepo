import { RetrievalService } from "./retrieval.service";
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
  content:
    overrides.content ?? "Reset the worker before retrying the failed job.",
  searchText:
    overrides.searchText ?? "reset the worker before retrying the failed job",
  checksum: overrides.checksum ?? "sum-1",
  sectionTitle: overrides.sectionTitle ?? "Troubleshooting",
  pageNumber: overrides.pageNumber ?? null,
  sourceTitle: overrides.sourceTitle ?? "Runbook",
  language: overrides.language ?? "en",
  metadataJson: overrides.metadataJson ?? null,
  semanticScore: overrides.semanticScore ?? 0.8,
  lexicalScore: overrides.lexicalScore ?? 0.6,
  recencyScore: overrides.recencyScore ?? 0,
  metadataScore: overrides.metadataScore ?? 0,
  structuralScore: overrides.structuralScore ?? 0.2,
  hybridScore: overrides.hybridScore ?? 0.7,
  semanticRank: overrides.semanticRank ?? 1,
  lexicalRank: overrides.lexicalRank ?? null,
  indexedAt: overrides.indexedAt ?? new Date("2026-03-01T00:00:00Z"),
  debug: overrides.debug ?? {
    retrievedBy: ["semantic"],
    rawSemanticDistance: 0.2,
    rawSemanticSimilarity: 0.8,
    rawLexicalScore: null,
    lexicalTokenCoverage: 0,
    lexicalPhraseCoverage: 0,
    metadataSignals: [],
    structuralSignals: [],
    selectionReason: "test",
    rankBeforeDedup: null,
    rankAfterDedup: null,
    dedupReason: null,
  },
});

describe("RetrievalService", () => {
  it("collapses near-identical adjacent chunks after reranking", async () => {
    const queries = {
      fetchSemanticCandidates: jest.fn().mockResolvedValue([]),
      fetchLexicalCandidates: jest.fn().mockResolvedValue([]),
    } as any;
    const normalizer = {
      preprocess: jest.fn().mockReturnValue({
        rawQuery: "reset worker",
        normalizedText: "reset worker",
        lexicalText: "reset worker",
        tokens: ["reset", "worker"],
        phrases: [],
        freshnessIntent: false,
        questionLike: false,
      }),
    } as any;
    const openai = {
      createQueryEmbedding: jest.fn().mockResolvedValue({
        status: "success",
        model: "text-embedding-3-small",
        usage: {
          inputTokens: 5,
          outputTokens: 0,
          totalTokens: 5,
          cachedInputTokens: 0,
          reasoningTokens: 0,
        },
        latencyMs: 10,
        dimensions: 2,
        embedding: [0.1, 0.2],
        errorCode: null,
      }),
      configuredEmbeddingModel: "text-embedding-3-small",
      embeddingsEnabled: true,
    } as any;
    const scorer = {
      weights: {
        semantic: 0.58,
        lexical: 0.22,
        metadata: 0.1,
        recency: 0.03,
        structural: 0.07,
      },
      mergeAndScore: jest.fn().mockReturnValue([
        candidate({ chunkId: "chunk-a", chunkNo: 10, checksum: "sum-a" }),
        candidate({
          chunkId: "chunk-b",
          chunkNo: 11,
          checksum: "sum-b",
          searchText: "reset worker before retrying failed job",
          hybridScore: 0.69,
        }),
        candidate({
          chunkId: "chunk-c",
          chunkNo: 20,
          checksum: "sum-c",
          searchText: "capture the request id before escalation",
          hybridScore: 0.55,
        }),
      ]),
    } as any;
    const metrics = {
      increment: jest.fn(),
      recordDuration: jest.fn(),
    } as any;
    const jsonLogger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() } as any;

    const service = new RetrievalService(
      queries,
      normalizer,
      openai,
      scorer,
      metrics,
      jsonLogger,
    );

    const result = await service.retrieve({
      kbId: "kb-1",
      userId: "user-1",
      isAdmin: true,
      query: "reset worker",
      groundingLimit: 5,
    });

    expect(result.selectedChunks.map((item) => item.chunkId)).toEqual([
      "chunk-a",
      "chunk-c",
    ]);
    expect(queries.fetchSemanticCandidates).toHaveBeenCalledWith(
      expect.objectContaining({
        embeddingDim: 2,
        embeddingModel: "text-embedding-3-small",
      }),
    );
    expect(result.debug.rankedCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ chunkId: "chunk-a", rankAfterDedup: 1 }),
        expect.objectContaining({
          chunkId: "chunk-b",
          rankAfterDedup: null,
          dedupReason: expect.stringContaining("near-duplicate"),
        }),
      ]),
    );
  });

  it("falls back to lexical retrieval when query embedding generation fails", async () => {
    const queries = {
      fetchSemanticCandidates: jest.fn().mockResolvedValue([]),
      fetchLexicalCandidates: jest.fn().mockResolvedValue([]),
    } as any;
    const normalizer = {
      preprocess: jest.fn().mockReturnValue({
        rawQuery: "reset worker",
        normalizedText: "reset worker",
        lexicalText: "reset worker",
        tokens: ["reset", "worker"],
        phrases: [],
        freshnessIntent: false,
        questionLike: false,
      }),
    } as any;
    const openai = {
      createQueryEmbedding: jest.fn().mockResolvedValue({
        status: "failed",
        reason: "provider_error",
        model: "text-embedding-3-small",
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          cachedInputTokens: 0,
          reasoningTokens: 0,
        },
        latencyMs: 12,
        dimensions: null,
        embedding: null,
        errorCode: "OPENAI_RATE_LIMIT",
      }),
      configuredEmbeddingModel: "text-embedding-3-small",
      embeddingsEnabled: true,
    } as any;
    const scorer = {
      weights: {
        semantic: 0.58,
        lexical: 0.22,
        metadata: 0.1,
        recency: 0.03,
        structural: 0.07,
      },
      mergeAndScore: jest.fn().mockReturnValue([]),
    } as any;
    const metrics = {
      increment: jest.fn(),
      recordDuration: jest.fn(),
    } as any;
    const jsonLogger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() } as any;

    const service = new RetrievalService(
      queries,
      normalizer,
      openai,
      scorer,
      metrics,
      jsonLogger,
    );

    await service.retrieve({
      kbId: "kb-1",
      userId: "user-1",
      isAdmin: false,
      query: "reset worker",
    });

    expect(queries.fetchSemanticCandidates).not.toHaveBeenCalled();
    expect(queries.fetchLexicalCandidates).toHaveBeenCalledTimes(1);
  });
});
