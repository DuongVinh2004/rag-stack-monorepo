import { Injectable } from "@nestjs/common";
import {
  CITATION_POLICY_VERSION,
  MAX_CITATION_SNIPPET_LENGTH,
  MIN_CITATION_SUPPORT_SCORE,
  getCitationLimit,
} from "./chat.constants";
import {
  CitationAssemblyResult,
  CitationView,
  RetrievalCandidate,
} from "./chat.types";
import {
  clamp01,
  computeJaccard,
  computePhraseCoverage,
  computeTokenCoverage,
  extractMatchingTerms,
  extractQuotedPhrases,
  normalizeTextForMatch,
  normalizeWhitespace,
} from "./retrieval-scoring.utils";

type PreparedCitationCandidate = {
  chunk: RetrievalCandidate;
  supportScore: number;
  answerCoverage: number;
  queryCoverage: number;
  groundingRank: number;
  snippet: string;
};

type TextWindow = {
  text: string;
  start: number;
  end: number;
};

@Injectable()
export class CitationAssemblerService {
  assemble(params: {
    usedChunkIds: string[];
    selectedChunks: RetrievalCandidate[];
    normalizedQuery: string;
    answerText: string;
  }): CitationAssemblyResult {
    const maxCitations = getCitationLimit();
    const requestedChunkIds = Array.from(
      new Set(
        params.usedChunkIds.map((chunkId) => chunkId.trim()).filter(Boolean),
      ),
    );
    const groundingMap = new Map(
      params.selectedChunks.map(
        (chunk, index) =>
          [chunk.chunkId, { chunk, groundingRank: index + 1 }] as const,
      ),
    );
    const queryTokens = extractMatchingTerms(params.normalizedQuery);
    const queryPhrases = extractQuotedPhrases(params.normalizedQuery);
    const answerTokens = extractMatchingTerms(params.answerText);
    const preparedCandidates: PreparedCitationCandidate[] = [];
    const rejectedChunkIds: Array<{ chunkId: string; reason: string }> = [];

    requestedChunkIds.forEach((chunkId) => {
      const groundedCandidate = groundingMap.get(chunkId);
      if (!groundedCandidate) {
        rejectedChunkIds.push({
          chunkId,
          reason: "not_in_grounding_set",
        });
        return;
      }

      const prepared = this.prepareCandidate({
        answerText: params.answerText,
        answerTokens,
        chunk: groundedCandidate.chunk,
        groundingRank: groundedCandidate.groundingRank,
        normalizedQuery: params.normalizedQuery,
        queryPhrases,
        queryTokens,
      });

      if ("reason" in prepared) {
        rejectedChunkIds.push({
          chunkId,
          reason: prepared.reason,
        });
        return;
      }

      if (prepared.supportScore < MIN_CITATION_SUPPORT_SCORE) {
        rejectedChunkIds.push({
          chunkId,
          reason: "support_too_weak",
        });
        return;
      }

      preparedCandidates.push(prepared);
    });

    const sorted = preparedCandidates.sort((left, right) =>
      this.comparePreparedCandidates(left, right),
    );
    const selected: PreparedCitationCandidate[] = [];

    sorted.forEach((candidate) => {
      const redundantReason = selected
        .map((existing) => this.findRedundantReason(existing, candidate))
        .find(Boolean);

      if (redundantReason) {
        rejectedChunkIds.push({
          chunkId: candidate.chunk.chunkId,
          reason: redundantReason,
        });
        return;
      }

      if (selected.length >= maxCitations) {
        rejectedChunkIds.push({
          chunkId: candidate.chunk.chunkId,
          reason: "citation_limit_exceeded",
        });
        return;
      }

      selected.push(candidate);
    });

    const citations = selected.map((candidate, index) =>
      this.toCitationView(candidate, index + 1),
    );

    return {
      citations,
      debug: {
        policyVersion: CITATION_POLICY_VERSION,
        granularity: "answer_level",
        maxCitations,
        requestedChunkIds,
        acceptedChunkIds: citations.map((citation) => citation.chunkId),
        rejectedChunkIds,
      },
    };
  }

  buildSnippet(params: {
    content: string;
    normalizedQuery: string;
    answerText: string;
  }) {
    const text = normalizeWhitespace(params.content);
    if (!text) {
      return null;
    }

    const answerTokens = extractMatchingTerms(params.answerText);
    const queryTokens = extractMatchingTerms(params.normalizedQuery);
    const queryPhrases = extractQuotedPhrases(params.normalizedQuery);
    const windows = this.buildCandidateWindows(text);

    let bestWindow: TextWindow | null = null;
    let bestScore = -1;

    windows.forEach((window) => {
      const answerCoverage = computeTokenCoverage(window.text, answerTokens);
      const queryCoverage = computeTokenCoverage(window.text, queryTokens);
      const phraseCoverage = computePhraseCoverage(window.text, queryPhrases);
      const score =
        0.5 * answerCoverage + 0.3 * queryCoverage + 0.2 * phraseCoverage;

      if (
        score > bestScore ||
        (score === bestScore &&
          bestWindow &&
          this.compareWindows(window, bestWindow) < 0)
      ) {
        bestScore = score;
        bestWindow = window;
      }
    });

    if (!bestWindow || bestScore <= 0) {
      return this.trimExcerpt({
        text,
        start: 0,
        end: Math.min(text.length, MAX_CITATION_SNIPPET_LENGTH),
      });
    }

    if (bestWindow.text.length <= MAX_CITATION_SNIPPET_LENGTH) {
      return this.trimExcerpt({
        text,
        start: bestWindow.start,
        end: bestWindow.end,
      });
    }

    const anchorIndex = this.findBestAnchorIndex(bestWindow.text, {
      answerTokens,
      queryTokens,
      queryPhrases,
    });
    const anchorStart = bestWindow.start + anchorIndex;
    const excerptStart = Math.max(
      bestWindow.start,
      anchorStart - Math.floor(MAX_CITATION_SNIPPET_LENGTH / 3),
    );
    const excerptEnd = Math.min(
      bestWindow.end,
      excerptStart + MAX_CITATION_SNIPPET_LENGTH,
    );

    return this.trimExcerpt({
      text,
      start: excerptStart,
      end: excerptEnd,
    });
  }

  private prepareCandidate(params: {
    normalizedQuery: string;
    answerText: string;
    chunk: RetrievalCandidate;
    groundingRank: number;
    queryTokens: string[];
    queryPhrases: string[];
    answerTokens: string[];
  }) {
    const snippet = this.buildSnippet({
      content: params.chunk.content,
      normalizedQuery: params.normalizedQuery,
      answerText: params.answerText,
    });

    if (!snippet) {
      return { reason: "snippet_unavailable" } as const;
    }

    const answerCoverage = computeTokenCoverage(
      params.chunk.searchText || params.chunk.content,
      params.answerTokens,
    );
    const queryCoverage = Math.max(
      computeTokenCoverage(
        params.chunk.searchText || params.chunk.content,
        params.queryTokens,
      ),
      computePhraseCoverage(
        params.chunk.searchText || params.chunk.content,
        params.queryPhrases,
      ),
    );
    const supportScore = clamp01(
      0.75 * params.chunk.hybridScore +
        0.15 * answerCoverage +
        0.1 * queryCoverage,
    );

    return {
      chunk: params.chunk,
      supportScore: Number(supportScore.toFixed(6)),
      answerCoverage: Number(answerCoverage.toFixed(6)),
      queryCoverage: Number(queryCoverage.toFixed(6)),
      groundingRank: params.groundingRank,
      snippet,
    };
  }

  private toCitationView(
    candidate: PreparedCitationCandidate,
    rank: number,
  ): CitationView {
    return {
      rank,
      score: candidate.supportScore,
      chunkId: candidate.chunk.chunkId,
      documentId: candidate.chunk.documentId,
      documentTitle: candidate.chunk.documentTitle,
      snippet: candidate.snippet,
      page: candidate.chunk.pageNumber,
      section: candidate.chunk.sectionTitle,
    };
  }

  private comparePreparedCandidates(
    left: PreparedCitationCandidate,
    right: PreparedCitationCandidate,
  ) {
    if (right.supportScore !== left.supportScore) {
      return right.supportScore - left.supportScore;
    }
    if (right.chunk.hybridScore !== left.chunk.hybridScore) {
      return right.chunk.hybridScore - left.chunk.hybridScore;
    }
    if (right.answerCoverage !== left.answerCoverage) {
      return right.answerCoverage - left.answerCoverage;
    }
    if (right.queryCoverage !== left.queryCoverage) {
      return right.queryCoverage - left.queryCoverage;
    }
    if (left.groundingRank !== right.groundingRank) {
      return left.groundingRank - right.groundingRank;
    }
    const leftPage = left.chunk.pageNumber ?? Number.MAX_SAFE_INTEGER;
    const rightPage = right.chunk.pageNumber ?? Number.MAX_SAFE_INTEGER;
    if (leftPage !== rightPage) {
      return leftPage - rightPage;
    }
    return left.chunk.chunkId.localeCompare(right.chunk.chunkId);
  }

  private findRedundantReason(
    existing: PreparedCitationCandidate,
    candidate: PreparedCitationCandidate,
  ) {
    if (existing.chunk.chunkId === candidate.chunk.chunkId) {
      return `duplicate_of_${existing.chunk.chunkId}`;
    }

    if (existing.chunk.documentId !== candidate.chunk.documentId) {
      return null;
    }

    const overlap = computeJaccard(
      existing.chunk.searchText || existing.chunk.content,
      candidate.chunk.searchText || candidate.chunk.content,
    );
    const sameSection =
      normalizeTextForMatch(existing.chunk.sectionTitle) ===
      normalizeTextForMatch(candidate.chunk.sectionTitle);
    const samePage =
      existing.chunk.pageNumber !== null &&
      candidate.chunk.pageNumber !== null &&
      existing.chunk.pageNumber === candidate.chunk.pageNumber;
    const nearAdjacentChunk =
      existing.chunk.documentVersionId === candidate.chunk.documentVersionId &&
      Math.abs(existing.chunk.chunkNo - candidate.chunk.chunkNo) <= 1;

    if (overlap >= 0.9 && nearAdjacentChunk) {
      return `near_duplicate_of_${existing.chunk.chunkId}`;
    }

    if (sameSection && (samePage || nearAdjacentChunk) && overlap >= 0.82) {
      return `same_section_redundant_with_${existing.chunk.chunkId}`;
    }

    return null;
  }

  private buildCandidateWindows(text: string) {
    const sentencePattern = /[^.!?\n]+(?:[.!?]+|$)/g;
    const sentences: TextWindow[] = [];
    let match: RegExpExecArray | null;

    while ((match = sentencePattern.exec(text)) !== null) {
      const raw = match[0];
      const trimmed = raw.trim();
      if (!trimmed) {
        continue;
      }
      const start = match.index + raw.indexOf(trimmed);
      const end = start + trimmed.length;
      sentences.push({ text: trimmed, start, end });
    }

    if (!sentences.length) {
      return [{ text, start: 0, end: text.length }];
    }

    const windows = [...sentences];
    for (let index = 0; index < sentences.length - 1; index += 1) {
      const first = sentences[index];
      const second = sentences[index + 1];
      const combined = text.slice(first.start, second.end).trim();
      if (!combined || combined.length > MAX_CITATION_SNIPPET_LENGTH * 1.5) {
        continue;
      }
      windows.push({
        text: combined,
        start: first.start,
        end: second.end,
      });
    }

    return windows;
  }

  private compareWindows(left: TextWindow, right: TextWindow) {
    if (left.start !== right.start) {
      return left.start - right.start;
    }
    if (left.text.length !== right.text.length) {
      return left.text.length - right.text.length;
    }
    return left.text.localeCompare(right.text);
  }

  private findBestAnchorIndex(
    text: string,
    params: {
      answerTokens: string[];
      queryTokens: string[];
      queryPhrases: string[];
    },
  ) {
    const lower = text.toLowerCase();
    const anchorCandidates = [
      ...params.queryPhrases,
      ...params.answerTokens,
      ...params.queryTokens,
    ]
      .map((term) => lower.indexOf(term.toLowerCase()))
      .filter((position) => position >= 0)
      .sort((left, right) => left - right);

    return anchorCandidates[0] ?? 0;
  }

  private trimExcerpt(params: { text: string; start: number; end: number }) {
    const boundedStart = Math.max(
      0,
      Math.min(params.start, params.text.length),
    );
    const boundedEnd = Math.max(
      boundedStart,
      Math.min(params.end, params.text.length),
    );
    const start = this.alignStartToWord(params.text, boundedStart);
    const end = this.alignEndToWord(params.text, boundedEnd);
    const core = params.text.slice(start, end).trim();

    if (!core) {
      return null;
    }

    return `${start > 0 ? "... " : ""}${core}${end < params.text.length ? " ..." : ""}`;
  }

  private alignStartToWord(text: string, start: number) {
    if (start <= 0) {
      return 0;
    }

    let cursor = start;
    while (cursor > 0 && !/\s/.test(text[cursor - 1] ?? "")) {
      cursor -= 1;
    }
    return cursor;
  }

  private alignEndToWord(text: string, end: number) {
    if (end >= text.length) {
      return text.length;
    }

    let cursor = end;
    while (cursor < text.length && !/\s/.test(text[cursor] ?? "")) {
      cursor += 1;
    }
    return cursor;
  }
}
