import { Injectable } from "@nestjs/common";
import { CitationAssemblerService } from "./citation-assembler.service";
import { RetrievalCandidate } from "./chat.types";
import { GroundedAnswerResult } from "../openai/openai.types";

const LOCAL_GROUNDED_CHAT_MODEL = "local.extractive-grounded-v1";
const MAX_LOCAL_GROUNDED_CHUNKS = 3;
const MIN_FOLLOW_ON_CHUNK_SCORE = 0.08;
const FOLLOW_ON_CHUNK_SCORE_RATIO = 0.75;
const MIN_PREFIX_MATCH_LENGTH = 4;
const LOCAL_STOP_WORDS = new Set([
  "about",
  "after",
  "before",
  "from",
  "have",
  "into",
  "that",
  "their",
  "them",
  "they",
  "this",
  "what",
  "when",
  "where",
  "which",
  "while",
  "with",
]);

@Injectable()
export class LocalGroundedAnswerService {
  constructor(
    private readonly citations: CitationAssemblerService,
  ) {}

  get modelName() {
    return LOCAL_GROUNDED_CHAT_MODEL;
  }

  async createGroundedAnswer(params: {
    question: string;
    normalizedQuery: string;
    selectedChunks: RetrievalCandidate[];
  }): Promise<GroundedAnswerResult> {
    const startedAt = Date.now();
    const chosenChunks = this.selectChunks(
      params.question,
      params.selectedChunks,
    );
    const snippets = chosenChunks
      .map((chunk) => ({
        chunkId: chunk.chunkId,
        text: this.cleanSnippet(
          this.citations.buildSnippet({
            content: chunk.content,
            normalizedQuery: params.normalizedQuery,
            answerText: params.question,
          }) ?? chunk.content,
        ),
      }))
      .filter((entry) => entry.text.length > 0);

    if (!snippets.length) {
      return {
        answer: {
          status: "insufficient_data",
          answer:
            "Tôi không thể tổng hợp câu trả lời có trích dẫn từ các nguồn dữ liệu hiện có.",
          usedChunkIds: [],
        },
        latencyMs: Date.now() - startedAt,
        model: this.modelName,
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          cachedInputTokens: 0,
          reasoningTokens: 0,
        },
      };
    }

    return {
      answer: {
        status: "grounded",
        answer: this.composeAnswer(snippets.map((entry) => entry.text)),
        usedChunkIds: snippets.map((entry) => entry.chunkId),
      },
      latencyMs: Date.now() - startedAt,
      model: this.modelName,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cachedInputTokens: 0,
        reasoningTokens: 0,
      },
    };
  }

  private selectChunks(question: string, selectedChunks: RetrievalCandidate[]) {
    if (!selectedChunks.length) {
      return [];
    }

    const queryTerms = this.extractTerms(question);
    const chosen: RetrievalCandidate[] = [];
    const coveredTerms = new Set<string>();
    const topScore = selectedChunks[0]?.hybridScore ?? 0;

    for (const chunk of selectedChunks) {
      if (chosen.length >= MAX_LOCAL_GROUNDED_CHUNKS) {
        break;
      }

      if (
        chosen.length > 0 &&
        chunk.hybridScore <
          Math.max(MIN_FOLLOW_ON_CHUNK_SCORE, topScore * FOLLOW_ON_CHUNK_SCORE_RATIO)
      ) {
        continue;
      }

      const chunkTerms = this.extractTerms(chunk.searchText || chunk.content);
      const matchedTerms = [...queryTerms].filter((term) =>
        chunkTerms.some((chunkTerm) => this.termsMatch(term, chunkTerm)),
      );
      const addsCoverage = matchedTerms.some((term) => !coveredTerms.has(term));

      if (chosen.length > 0 && !addsCoverage) {
        continue;
      }

      matchedTerms.forEach((term) => coveredTerms.add(term));
      chosen.push(chunk);
    }

    return chosen.length ? chosen : [selectedChunks[0]];
  }

  private composeAnswer(snippets: string[]) {
    return snippets
      .map((snippet) => this.ensureSentence(snippet))
      .filter((snippet, index, all) => all.indexOf(snippet) === index)
      .join(" ")
      .slice(0, 1600);
  }

  private cleanSnippet(value: string) {
    return value
      .replace(/^\.{3}\s*/, "")
      .replace(/\s*\.{3}$/, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  private ensureSentence(value: string) {
    if (!value.length) {
      return value;
    }

    if (/[.!?]$/.test(value)) {
      return value;
    }

    return `${value}.`;
  }

  private extractTerms(input: string) {
    return input
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3)
      .filter((token) => !LOCAL_STOP_WORDS.has(token));
  }

  private termsMatch(left: string, right: string) {
    if (left === right) {
      return true;
    }

    return (
      left.length >= MIN_PREFIX_MATCH_LENGTH &&
      right.length >= MIN_PREFIX_MATCH_LENGTH &&
      (left.startsWith(right) || right.startsWith(left))
    );
  }
}
