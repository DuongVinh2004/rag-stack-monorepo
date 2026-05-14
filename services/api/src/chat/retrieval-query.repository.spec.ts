import { RetrievalQueryRepository } from "./retrieval-query.repository";

describe("RetrievalQueryRepository", () => {
  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue([]),
  } as any;

  beforeEach(() => {
    prisma.$queryRaw.mockClear();
  });

  it("enforces KB scope and membership checks in semantic retrieval SQL", async () => {
    const repository = new RetrievalQueryRepository(prisma);

    await repository.fetchSemanticCandidates({
      kbId: "11111111-1111-1111-1111-111111111111",
      userId: "22222222-2222-2222-2222-222222222222",
      isAdmin: false,
      queryEmbedding: [0.1, 0.2],
      embeddingDim: 2,
      embeddingModel: "text-embedding-3-small",
      filters: { documentIds: [], languages: [] },
      candidateLimit: 10,
    });

    const sql = prisma.$queryRaw.mock.calls[0][0];
    const sqlText = sql.strings.join(" ");

    expect(sqlText).toContain('dc."kbId" = CAST(');
    expect(sqlText).toContain('km."userId" IS NOT NULL');
    expect(sqlText).toContain('kb."status" = \'ACTIVE\'::"KbStatus"');
    expect(sqlText).toContain('dc."supersededAt" IS NULL');
    expect(sqlText).toContain('dc."embeddingDim" = ');
    expect(sqlText).not.toContain('kb."visibility"');
  });

  it("uses scoped lexical retrieval with websearch_to_tsquery for quoted phrases", async () => {
    const repository = new RetrievalQueryRepository(prisma);

    await repository.fetchLexicalCandidates({
      kbId: "11111111-1111-1111-1111-111111111111",
      userId: "22222222-2222-2222-2222-222222222222",
      isAdmin: true,
      normalizedQuery: {
        rawQuery: '"request id" escalation',
        normalizedText: '"request id" escalation',
        lexicalText: '"request id" escalation',
        tokens: ["request", "id", "escalation"],
        phrases: ["request id"],
        freshnessIntent: false,
        questionLike: false,
      },
      filters: {
        documentIds: ["33333333-3333-3333-3333-333333333333"],
        languages: ["en"],
      },
      candidateLimit: 5,
    });

    const sql = prisma.$queryRaw.mock.calls[0][0];
    const sqlText = sql.strings.join(" ");

    expect(sqlText).toContain("to_tsquery('english',");
    expect(sqlText).toContain("to_tsvector('english',");
    expect(sqlText).toContain("concat_ws(");
    expect(sqlText).toContain('dc."supersededAt" IS NULL');
    expect(sqlText).toContain('dc."documentId" IN (');
    expect(sqlText).toContain("LOWER(COALESCE(dc.\"language\", '')) IN (");
  });
});
