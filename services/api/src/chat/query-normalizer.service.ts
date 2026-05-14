import { Injectable } from "@nestjs/common";
import { NormalizedRetrievalQuery } from "./chat.types";
import {
  detectFreshnessIntent,
  detectQuestionLikeQuery,
  extractMatchingTerms,
  extractQuotedPhrases,
  normalizeQuotedQuery,
} from "./retrieval-scoring.utils";

@Injectable()
export class QueryNormalizerService {
  normalize(query: string) {
    return this.preprocess(query).normalizedText;
  }

  preprocess(query: string): NormalizedRetrievalQuery {
    const sanitized = normalizeQuotedQuery(query);
    const normalizedText = sanitized.toLowerCase();
    const phrases = extractQuotedPhrases(normalizedText);
    const tokens = extractMatchingTerms(normalizedText);
    const phraseTokens = new Set(
      phrases.flatMap((phrase) => extractMatchingTerms(phrase)),
    );
    const lexicalText = [
      ...phrases.map((phrase) => `"${phrase}"`),
      ...tokens.filter((token) => !phraseTokens.has(token)),
    ].join(" ");

    return {
      rawQuery: query,
      normalizedText,
      lexicalText,
      tokens,
      phrases,
      freshnessIntent: detectFreshnessIntent(tokens, phrases),
      questionLike: detectQuestionLikeQuery(query, tokens),
    };
  }
}
