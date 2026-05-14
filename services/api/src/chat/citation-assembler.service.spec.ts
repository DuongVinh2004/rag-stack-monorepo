import { CitationAssemblerService } from "./citation-assembler.service";
import { RetrievalCandidate } from "./chat.types";

const chunk = (overrides: Partial<RetrievalCandidate>): RetrievalCandidate => ({
  chunkId: overrides.chunkId ?? "chunk-1",
  documentId: overrides.documentId ?? "doc-1",
  documentTitle: overrides.documentTitle ?? "Runbook",
  documentVersionId: overrides.documentVersionId ?? "ver-1",
  kbId: overrides.kbId ?? "kb-1",
  chunkNo: overrides.chunkNo ?? 1,
  content:
    overrides.content ??
    "Reset the worker before retrying. Capture the request id for escalation.",
  searchText:
    overrides.searchText ??
    "reset the worker before retrying capture the request id for escalation",
  checksum: overrides.checksum ?? "sum-1",
  sectionTitle:
    overrides.sectionTitle === undefined
      ? "Troubleshooting"
      : overrides.sectionTitle,
  pageNumber: overrides.pageNumber === undefined ? 2 : overrides.pageNumber,
  sourceTitle: overrides.sourceTitle ?? "Runbook",
  language: overrides.language ?? "en",
  metadataJson: overrides.metadataJson ?? null,
  semanticScore: overrides.semanticScore ?? 0.7,
  lexicalScore: overrides.lexicalScore ?? 0.8,
  recencyScore: overrides.recencyScore ?? 0.3,
  metadataScore: overrides.metadataScore ?? 0,
  structuralScore: overrides.structuralScore ?? 0.2,
  hybridScore: overrides.hybridScore ?? 0.76,
  semanticRank: overrides.semanticRank ?? 1,
  lexicalRank: overrides.lexicalRank ?? 1,
  indexedAt: overrides.indexedAt ?? new Date(),
  debug: overrides.debug ?? {
    retrievedBy: ["semantic", "lexical"],
    rawSemanticDistance: 0.3,
    rawSemanticSimilarity: 0.7,
    rawLexicalScore: 0.8,
    lexicalTokenCoverage: 0.8,
    lexicalPhraseCoverage: 0,
    metadataSignals: [],
    structuralSignals: [],
    selectionReason: "test",
    rankBeforeDedup: 1,
    rankAfterDedup: 1,
    dedupReason: null,
  },
});

describe("CitationAssemblerService", () => {
  it("returns one answer-level citation from a real grounding chunk", () => {
    const service = new CitationAssemblerService();

    const result = service.assemble({
      usedChunkIds: ["chunk-1"],
      normalizedQuery: "request id retrying",
      answerText: "Include the request id when you escalate after retries.",
      selectedChunks: [chunk({ chunkId: "chunk-1" })],
    });

    expect(result.citations).toHaveLength(1);
    expect(result.citations[0].chunkId).toBe("chunk-1");
    expect(result.citations[0].snippet).toContain("request id");
    expect(result.debug.acceptedChunkIds).toEqual(["chunk-1"]);
  });

  it("ranks citations deterministically by support and grounding rank", () => {
    const service = new CitationAssemblerService();

    const result = service.assemble({
      usedChunkIds: ["chunk-b", "chunk-a"],
      normalizedQuery: "reset worker",
      answerText: "Reset the worker before retrying the failed job.",
      selectedChunks: [
        chunk({
          chunkId: "chunk-a",
          hybridScore: 0.8,
          content: "Reset the worker before retrying the failed job.",
          searchText: "reset the worker before retrying the failed job",
          pageNumber: 1,
        }),
        chunk({
          chunkId: "chunk-b",
          documentId: "doc-2",
          documentTitle: "Fallback Runbook",
          hybridScore: 0.8,
          content: "Restart the worker before retrying the failed job.",
          searchText: "restart the worker before retrying the failed job",
          pageNumber: 2,
        }),
      ],
    });

    expect(result.citations.map((citation) => citation.chunkId)).toEqual([
      "chunk-a",
      "chunk-b",
    ]);
  });

  it("keeps multiple citations from the same document when sections differ", () => {
    const service = new CitationAssemblerService();

    const result = service.assemble({
      usedChunkIds: ["chunk-1", "chunk-2"],
      normalizedQuery: "how do i reset the worker",
      answerText:
        "Reset the worker, then check the escalation section if retries still fail.",
      selectedChunks: [
        chunk({
          chunkId: "chunk-1",
          documentId: "doc-1",
          sectionTitle: "Troubleshooting",
          pageNumber: 2,
          content: "Reset the worker before retrying the failed job.",
          searchText: "reset the worker before retrying the failed job",
        }),
        chunk({
          chunkId: "chunk-2",
          documentId: "doc-1",
          chunkNo: 8,
          sectionTitle: "Escalation",
          pageNumber: 6,
          content:
            "If retries still fail, escalate with the request id and job id.",
          searchText:
            "if retries still fail escalate with the request id and job id",
          hybridScore: 0.7,
        }),
      ],
    });

    expect(result.citations.map((citation) => citation.chunkId)).toEqual([
      "chunk-1",
      "chunk-2",
    ]);
  });

  it("suppresses redundant same-document adjacent chunks", () => {
    const service = new CitationAssemblerService();

    const result = service.assemble({
      usedChunkIds: ["chunk-1", "chunk-2"],
      normalizedQuery: "request id escalation",
      answerText: "Include the request id when escalating.",
      selectedChunks: [
        chunk({
          chunkId: "chunk-1",
          documentId: "doc-1",
          documentVersionId: "ver-1",
          chunkNo: 2,
          sectionTitle: "Escalation",
          pageNumber: 4,
          content:
            "Include the request id and job id when escalating the incident.",
          searchText:
            "include the request id and job id when escalating the incident",
          hybridScore: 0.82,
        }),
        chunk({
          chunkId: "chunk-2",
          documentId: "doc-1",
          documentVersionId: "ver-1",
          chunkNo: 3,
          sectionTitle: "Escalation",
          pageNumber: 4,
          content:
            "Include request id and job id when escalating the incident.",
          searchText:
            "include request id and job id when escalating the incident",
          hybridScore: 0.81,
        }),
      ],
    });

    expect(result.citations.map((citation) => citation.chunkId)).toEqual([
      "chunk-1",
    ]);
    expect(result.debug.rejectedChunkIds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          chunkId: "chunk-2",
          reason: expect.stringContaining("duplicate"),
        }),
      ]),
    );
  });

  it("excludes chunk ids outside the authorized grounding set", () => {
    const service = new CitationAssemblerService();

    const result = service.assemble({
      usedChunkIds: ["missing-chunk", "chunk-1"],
      normalizedQuery: "reset worker",
      answerText: "Reset the worker.",
      selectedChunks: [chunk({ chunkId: "chunk-1" })],
    });

    expect(result.citations.map((citation) => citation.chunkId)).toEqual([
      "chunk-1",
    ]);
    expect(result.debug.rejectedChunkIds).toEqual(
      expect.arrayContaining([
        { chunkId: "missing-chunk", reason: "not_in_grounding_set" },
      ]),
    );
  });

  it("returns null page metadata when the source chunk has no page number", () => {
    const service = new CitationAssemblerService();

    const result = service.assemble({
      usedChunkIds: ["chunk-1"],
      normalizedQuery: "vacation policy",
      answerText: "The handbook covers vacation policy.",
      selectedChunks: [chunk({ pageNumber: null, sectionTitle: null })],
    });

    expect(result.citations[0].page).toBeNull();
    expect(result.citations[0].section).toBeNull();
  });

  it("builds a centered excerpt with ellipsis for long chunks", () => {
    const service = new CitationAssemblerService();

    const snippet = service.buildSnippet({
      content:
        "Intro text that does not matter. ".repeat(8) +
        "When escalating, include the request id and the failed job id in the incident ticket. " +
        "Closing text that also does not matter. ".repeat(8),
      normalizedQuery: "request id escalation",
      answerText: "Include the request id and failed job id when escalating.",
    });

    expect(snippet).toContain("request id");
    expect(snippet?.startsWith("...")).toBe(true);
    expect(snippet?.endsWith("...")).toBe(true);
  });
});
