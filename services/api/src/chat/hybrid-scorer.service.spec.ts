import { HybridScorerService } from "./hybrid-scorer.service";
import { NormalizedRetrievalQuery, RetrievalCandidate } from "./chat.types";

const candidate = (
  overrides: Partial<RetrievalCandidate>,
): RetrievalCandidate => ({
  chunkId: overrides.chunkId ?? "chunk-1",
  documentId: overrides.documentId ?? "doc-1",
  documentTitle: overrides.documentTitle ?? "Support Runbook",
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
  sourceTitle: overrides.sourceTitle ?? "Support Runbook",
  language: overrides.language ?? "en",
  metadataJson: overrides.metadataJson ?? null,
  semanticScore: overrides.semanticScore ?? 0,
  lexicalScore: overrides.lexicalScore ?? 0,
  recencyScore: overrides.recencyScore ?? 0,
  metadataScore: overrides.metadataScore ?? 0,
  structuralScore: overrides.structuralScore ?? 0,
  hybridScore: overrides.hybridScore ?? 0,
  semanticRank: overrides.semanticRank ?? null,
  lexicalRank: overrides.lexicalRank ?? null,
  indexedAt: overrides.indexedAt ?? new Date("2026-03-01T00:00:00Z"),
  debug: overrides.debug ?? {
    retrievedBy: overrides.semanticRank ? ["semantic"] : ["lexical"],
    rawSemanticDistance: overrides.semanticScore ? 0.5 : null,
    rawSemanticSimilarity: overrides.semanticScore
      ? overrides.semanticScore
      : null,
    rawLexicalScore:
      overrides.lexicalScore || overrides.lexicalRank ? 0.4 : null,
    lexicalTokenCoverage: 0,
    lexicalPhraseCoverage: 0,
    metadataSignals: [],
    structuralSignals: [],
    selectionReason: "",
    rankBeforeDedup: null,
    rankAfterDedup: null,
    dedupReason: null,
  },
});

const query = (
  overrides: Partial<NormalizedRetrievalQuery> = {},
): NormalizedRetrievalQuery => ({
  rawQuery: overrides.rawQuery ?? "How do I reset the worker?",
  normalizedText: overrides.normalizedText ?? "how do i reset the worker",
  lexicalText: overrides.lexicalText ?? "how do i reset the worker",
  tokens: overrides.tokens ?? ["reset", "worker"],
  phrases: overrides.phrases ?? [],
  freshnessIntent: overrides.freshnessIntent ?? false,
  questionLike: overrides.questionLike ?? true,
});

describe("HybridScorerService", () => {
  it("lets stronger semantic evidence beat a weak lexical-only hit", () => {
    const scorer = new HybridScorerService();

    const ranked = scorer.mergeAndScore({
      query: query(),
      filters: { documentIds: [], languages: [] },
      rerankPoolLimit: 10,
      semanticCandidates: [
        candidate({
          chunkId: "semantic-best",
          semanticScore: 0.9,
          semanticRank: 1,
          searchText:
            "restart the background worker to clear the stuck retry loop",
        }),
      ],
      lexicalCandidates: [
        candidate({
          chunkId: "lexical-weak",
          lexicalRank: 1,
          searchText: "worker status dashboard",
          debug: {
            retrievedBy: ["lexical"],
            rawSemanticDistance: null,
            rawSemanticSimilarity: null,
            rawLexicalScore: 0.03,
            lexicalTokenCoverage: 0,
            lexicalPhraseCoverage: 0,
            metadataSignals: [],
            structuralSignals: [],
            selectionReason: "",
            rankBeforeDedup: null,
            rankAfterDedup: null,
            dedupReason: null,
          },
        }),
      ],
    });

    expect(ranked.map((item) => item.chunkId)).toEqual([
      "semantic-best",
      "lexical-weak",
    ]);
    expect(ranked[0].hybridScore).toBeGreaterThan(ranked[1].hybridScore);
  });

  it("boosts exact phrase matches in lexical ranking", () => {
    const scorer = new HybridScorerService();

    const ranked = scorer.mergeAndScore({
      query: query({
        rawQuery: '"request id" escalation steps',
        normalizedText: '"request id" escalation steps',
        lexicalText: '"request id" escalation steps',
        tokens: ["request", "id", "escalation", "steps"],
        phrases: ["request id"],
      }),
      filters: { documentIds: [], languages: [] },
      rerankPoolLimit: 10,
      semanticCandidates: [],
      lexicalCandidates: [
        candidate({
          chunkId: "phrase-hit",
          lexicalRank: 1,
          searchText: "include the request id in the escalation template",
          debug: {
            retrievedBy: ["lexical"],
            rawSemanticDistance: null,
            rawSemanticSimilarity: null,
            rawLexicalScore: 0.25,
            lexicalTokenCoverage: 0,
            lexicalPhraseCoverage: 0,
            metadataSignals: [],
            structuralSignals: [],
            selectionReason: "",
            rankBeforeDedup: null,
            rankAfterDedup: null,
            dedupReason: null,
          },
        }),
        candidate({
          chunkId: "token-hit",
          lexicalRank: 2,
          searchText: "request metadata is required before an escalation",
          debug: {
            retrievedBy: ["lexical"],
            rawSemanticDistance: null,
            rawSemanticSimilarity: null,
            rawLexicalScore: 0.22,
            lexicalTokenCoverage: 0,
            lexicalPhraseCoverage: 0,
            metadataSignals: [],
            structuralSignals: [],
            selectionReason: "",
            rankBeforeDedup: null,
            rankAfterDedup: null,
            dedupReason: null,
          },
        }),
      ],
    });

    expect(ranked[0].chunkId).toBe("phrase-hit");
    expect(ranked[0].debug.lexicalPhraseCoverage).toBeGreaterThan(0);
    expect(ranked[0].lexicalScore).toBeGreaterThan(ranked[1].lexicalScore);
  });

  it("uses metadata filter alignment to break otherwise similar candidates", () => {
    const scorer = new HybridScorerService();

    const ranked = scorer.mergeAndScore({
      query: query({
        rawQuery: "reset worker",
        normalizedText: "reset worker",
        lexicalText: "reset worker",
      }),
      filters: { documentIds: ["doc-preferred"], languages: [] },
      rerankPoolLimit: 10,
      semanticCandidates: [
        candidate({
          chunkId: "doc-preferred-chunk",
          documentId: "doc-preferred",
          semanticScore: 0.7,
          semanticRank: 1,
          debug: {
            retrievedBy: ["semantic"],
            rawSemanticDistance: 0.6,
            rawSemanticSimilarity: 0.7,
            rawLexicalScore: null,
            lexicalTokenCoverage: 0,
            lexicalPhraseCoverage: 0,
            metadataSignals: ["document_filter"],
            structuralSignals: [],
            selectionReason: "",
            rankBeforeDedup: null,
            rankAfterDedup: null,
            dedupReason: null,
          },
        }),
        candidate({
          chunkId: "doc-other-chunk",
          documentId: "doc-other",
          semanticScore: 0.7,
          semanticRank: 2,
        }),
      ],
      lexicalCandidates: [],
    });

    expect(ranked[0].chunkId).toBe("doc-preferred-chunk");
    expect(ranked[0].metadataScore).toBeGreaterThan(ranked[1].metadataScore);
  });

  it("does not let recency outrank materially better evidence", () => {
    const scorer = new HybridScorerService();

    const ranked = scorer.mergeAndScore({
      query: query({
        rawQuery: "latest worker retry guidance",
        normalizedText: "latest worker retry guidance",
        lexicalText: "latest worker retry guidance",
        tokens: ["latest", "worker", "retry", "guidance"],
        freshnessIntent: true,
      }),
      filters: { documentIds: [], languages: [] },
      rerankPoolLimit: 10,
      semanticCandidates: [
        candidate({
          chunkId: "older-better",
          semanticScore: 0.9,
          semanticRank: 1,
          indexedAt: new Date("2025-10-01T00:00:00Z"),
        }),
        candidate({
          chunkId: "newer-weaker",
          semanticScore: 0.45,
          semanticRank: 2,
          indexedAt: new Date("2026-04-01T00:00:00Z"),
        }),
      ],
      lexicalCandidates: [],
    });

    expect(ranked[0].chunkId).toBe("older-better");
    expect(ranked[1].recencyScore).toBeGreaterThan(ranked[0].recencyScore);
  });

  it("breaks exact score ties deterministically by chunk id after other tie-breakers", () => {
    const scorer = new HybridScorerService();

    const ranked = scorer.mergeAndScore({
      query: query(),
      filters: { documentIds: [], languages: [] },
      rerankPoolLimit: 10,
      semanticCandidates: [
        candidate({
          chunkId: "chunk-z",
          semanticScore: 0.5,
          semanticRank: 1,
          indexedAt: new Date("2026-03-01T00:00:00Z"),
        }),
        candidate({
          chunkId: "chunk-a",
          semanticScore: 0.5,
          semanticRank: 2,
          indexedAt: new Date("2026-03-01T00:00:00Z"),
        }),
      ],
      lexicalCandidates: [],
    });

    expect(ranked.map((item) => item.chunkId)).toEqual(["chunk-a", "chunk-z"]);
    expect(ranked[0].debug.rankBeforeDedup).toBe(1);
  });
});
