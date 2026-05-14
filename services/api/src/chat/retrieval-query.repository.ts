import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { NormalizedRetrievalQuery, RetrievalCandidate } from "./chat.types";
import {
  extractMatchingTerms,
  normalizeSemanticDistance,
} from "./retrieval-scoring.utils";

type ChunkSearchRow = {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  documentVersionId: string;
  kbId: string;
  chunkNo: number;
  content: string;
  searchText: string;
  checksum: string;
  sectionTitle: string | null;
  pageNumber: number | null;
  sourceTitle: string | null;
  language: string | null;
  metadataJson: Record<string, unknown> | null;
  indexedAt: Date | null;
  semanticDistance?: number | null;
  semanticSimilarity?: number | null;
  lexicalRankScore?: number | null;
};

export type NormalizedChatFilters = {
  documentIds: string[];
  languages: string[];
};

const RETRIEVAL_BASE_SELECT = Prisma.sql`
  dc."id" AS "chunkId",
  dc."documentId" AS "documentId",
  d."name" AS "documentTitle",
  dc."documentVersionId" AS "documentVersionId",
  dc."kbId" AS "kbId",
  dc."chunkNo" AS "chunkNo",
  dc."content" AS "content",
  dc."searchText" AS "searchText",
  dc."checksum" AS "checksum",
  dc."sectionTitle" AS "sectionTitle",
  dc."pageNumber" AS "pageNumber",
  COALESCE(dc."sourceTitle", d."name") AS "sourceTitle",
  dc."language" AS "language",
  dc."metadataJson" AS "metadataJson",
  dv."indexedAt" AS "indexedAt"
`;

const LEXICAL_DOCUMENT_TEXT = Prisma.sql`
  concat_ws(
    ' ',
    dc."searchText",
    COALESCE(dc."sectionTitle", ''),
    COALESCE(dc."sourceTitle", ''),
    d."name"
  )
`;

const LEXICAL_DOCUMENT_VECTOR = Prisma.sql`
  to_tsvector('simple', ${LEXICAL_DOCUMENT_TEXT})
`;

@Injectable()
export class RetrievalQueryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async fetchSemanticCandidates(params: {
    kbId: string;
    userId: string;
    isAdmin: boolean;
    queryEmbedding: number[];
    embeddingDim: number;
    embeddingModel: string;
    filters: NormalizedChatFilters;
    candidateLimit: number;
  }) {
    const queryVector = `[${params.queryEmbedding.join(",")}]`;
    const scopeClause = this.buildScopeClause(params.kbId, params.isAdmin);
    const filterClause = this.buildFilterClause(params.filters);

    const rows = await this.prisma.$queryRaw<ChunkSearchRow[]>(Prisma.sql`
      SELECT
        ${RETRIEVAL_BASE_SELECT},
        (dc."embedding" <=> CAST(${queryVector} AS vector)) AS "semanticDistance",
        1 - (dc."embedding" <=> CAST(${queryVector} AS vector)) AS "semanticSimilarity"
      ${this.buildBaseFromClause(params.userId)}
      WHERE
        ${scopeClause}
        AND kb."status" = 'ACTIVE'::"KbStatus"
        AND d."status" = 'INDEXED'::"DocumentStatus"
        AND dv."status" = 'INDEXED'::"DocumentVersionStatus"
        AND dc."supersededAt" IS NULL
        AND dc."embedding" IS NOT NULL
        AND dc."embeddingModel" = ${params.embeddingModel}
        AND dc."embeddingDim" = ${params.embeddingDim}
        ${filterClause}
      ORDER BY dc."embedding" <=> CAST(${queryVector} AS vector) ASC, dv."indexedAt" DESC NULLS LAST, dc."id" ASC
      LIMIT ${params.candidateLimit}
    `);

    return this.mapRowsToCandidates(rows, params.filters, "semantic");
  }

  async fetchLexicalCandidates(params: {
    kbId: string;
    userId: string;
    isAdmin: boolean;
    normalizedQuery: NormalizedRetrievalQuery;
    filters: NormalizedChatFilters;
    candidateLimit: number;
  }) {
    const scopeClause = this.buildScopeClause(params.kbId, params.isAdmin);
    const filterClause = this.buildFilterClause(params.filters);
    const lexicalTsQuery = this.buildLexicalTsQuery(params.normalizedQuery);

    if (!lexicalTsQuery) {
      return [];
    }

    const rows = await this.prisma.$queryRaw<ChunkSearchRow[]>(Prisma.sql`
      SELECT
        ${RETRIEVAL_BASE_SELECT},
        ts_rank_cd(
          ${LEXICAL_DOCUMENT_VECTOR},
          to_tsquery('simple', ${lexicalTsQuery})
        ) AS "lexicalRankScore"
      ${this.buildBaseFromClause(params.userId)}
      WHERE
        ${scopeClause}
        AND kb."status" = 'ACTIVE'::"KbStatus"
        AND d."status" = 'INDEXED'::"DocumentStatus"
        AND dv."status" = 'INDEXED'::"DocumentVersionStatus"
        AND dc."supersededAt" IS NULL
        AND ${LEXICAL_DOCUMENT_VECTOR} @@ to_tsquery('simple', ${lexicalTsQuery})
        ${filterClause}
      ORDER BY "lexicalRankScore" DESC, dv."indexedAt" DESC NULLS LAST, dc."id" ASC
      LIMIT ${params.candidateLimit}
    `);

    return this.mapRowsToCandidates(rows, params.filters, "lexical");
  }

  private buildBaseFromClause(userId: string) {
    return Prisma.sql`
      FROM "DocumentChunk" dc
      JOIN "DocumentVersion" dv ON dv."id" = dc."documentVersionId"
      JOIN "Document" d ON d."id" = dc."documentId"
      JOIN "KnowledgeBase" kb ON kb."id" = dc."kbId"
      LEFT JOIN "KbMember" km ON km."kbId" = kb."id" AND km."userId" = CAST(${userId} AS uuid)
    `;
  }

  private buildScopeClause(kbId: string, isAdmin: boolean) {
    return Prisma.sql`
      dc."kbId" = CAST(${kbId} AS uuid)
      AND (${isAdmin} = TRUE OR km."userId" IS NOT NULL)
    `;
  }

  private buildFilterClause(filters: NormalizedChatFilters) {
    const clauses: Prisma.Sql[] = [];

    if (filters.documentIds.length) {
      clauses.push(
        Prisma.sql`dc."documentId" IN (${Prisma.join(
          filters.documentIds.map(
            (documentId) => Prisma.sql`CAST(${documentId} AS uuid)`,
          ),
        )})`,
      );
    }

    if (filters.languages.length) {
      clauses.push(
        Prisma.sql`LOWER(COALESCE(dc."language", '')) IN (${Prisma.join(filters.languages)})`,
      );
    }

    if (!clauses.length) {
      return Prisma.empty;
    }

    return Prisma.sql`AND ${Prisma.join(clauses, " AND ")}`;
  }

  private mapRowsToCandidates(
    rows: ChunkSearchRow[],
    filters: NormalizedChatFilters,
    scoreType: "semantic" | "lexical",
  ) {
    return rows.map((row, index) =>
      this.toCandidate({
        row,
        lexicalRank: scoreType === "lexical" ? index + 1 : null,
        rawLexicalScore:
          scoreType === "lexical" ? Number(row.lexicalRankScore ?? 0) : null,
        semanticRank: scoreType === "semantic" ? index + 1 : null,
        semanticDistance:
          scoreType === "semantic"
            ? Number(row.semanticDistance ?? Number.NaN)
            : null,
        semanticSimilarity:
          scoreType === "semantic"
            ? Number(row.semanticSimilarity ?? Number.NaN)
            : null,
        metadataSignals: this.calculateMetadataSignals(row, filters),
      }),
    );
  }

  private toCandidate(params: {
    row: ChunkSearchRow;
    semanticDistance: number | null;
    semanticSimilarity: number | null;
    rawLexicalScore: number | null;
    semanticRank: number | null;
    lexicalRank: number | null;
    metadataSignals: string[];
  }): RetrievalCandidate {
    return {
      chunkId: params.row.chunkId,
      documentId: params.row.documentId,
      documentTitle: params.row.documentTitle,
      documentVersionId: params.row.documentVersionId,
      kbId: params.row.kbId,
      chunkNo: params.row.chunkNo,
      content: params.row.content,
      searchText: params.row.searchText,
      checksum: params.row.checksum,
      sectionTitle: params.row.sectionTitle,
      pageNumber: params.row.pageNumber,
      sourceTitle: params.row.sourceTitle,
      language: params.row.language,
      metadataJson: params.row.metadataJson,
      semanticScore: normalizeSemanticDistance(params.semanticDistance),
      lexicalScore: 0,
      semanticRank: params.semanticRank,
      lexicalRank: params.lexicalRank,
      metadataScore: 0,
      recencyScore: 0,
      structuralScore: 0,
      hybridScore: 0,
      indexedAt: params.row.indexedAt,
      debug: {
        retrievedBy: params.semanticRank ? ["semantic"] : ["lexical"],
        rawSemanticDistance:
          params.semanticDistance !== null &&
          Number.isFinite(params.semanticDistance)
            ? params.semanticDistance
            : null,
        rawSemanticSimilarity:
          params.semanticSimilarity !== null &&
          Number.isFinite(params.semanticSimilarity)
            ? params.semanticSimilarity
            : null,
        rawLexicalScore:
          params.rawLexicalScore !== null &&
          Number.isFinite(params.rawLexicalScore)
            ? params.rawLexicalScore
            : null,
        lexicalTokenCoverage: 0,
        lexicalPhraseCoverage: 0,
        metadataSignals: params.metadataSignals,
        structuralSignals: [],
        selectionReason: "",
        rankBeforeDedup: null,
        rankAfterDedup: null,
        dedupReason: null,
      },
    };
  }

  private calculateMetadataSignals(
    candidate: ChunkSearchRow,
    filters: NormalizedChatFilters,
  ) {
    const matched: string[] = [];
    if (
      filters.documentIds.length &&
      filters.documentIds.includes(candidate.documentId)
    ) {
      matched.push("document_filter");
    }
    if (
      filters.languages.length &&
      candidate.language &&
      filters.languages.includes(candidate.language.toLowerCase())
    ) {
      matched.push("language_filter");
    }

    return matched;
  }

  private buildLexicalTsQuery(query: NormalizedRetrievalQuery) {
    const phraseTokens = new Set<string>();
    const phraseClauses = query.phrases
      .map((phrase) => {
        const tokens = extractMatchingTerms(phrase);
        tokens.forEach((token) => phraseTokens.add(token));
        if (!tokens.length) {
          return null;
        }

        return tokens.map((token) => `${token}:*`).join(" <-> ");
      })
      .filter((clause): clause is string => Boolean(clause));

    const tokenClauses = query.tokens
      .filter((token) => !phraseTokens.has(token))
      .map((token) => `${token}:*`);

    return [...phraseClauses, ...tokenClauses].join(" | ");
  }
}
