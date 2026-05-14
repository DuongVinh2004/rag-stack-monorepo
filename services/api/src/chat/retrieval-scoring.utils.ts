const MATCH_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "can",
  "did",
  "do",
  "does",
  "for",
  "from",
  "how",
  "in",
  "into",
  "is",
  "it",
  "of",
  "on",
  "or",
  "our",
  "should",
  "that",
  "the",
  "their",
  "there",
  "these",
  "they",
  "this",
  "to",
  "was",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "with",
  "would",
  "your",
  // Vietnamese
  "là",
  "và",
  "của",
  "các",
  "những",
  "cho",
  "để",
  "một",
  "có",
  "không",
  "thì",
  "mà",
  "như",
  "với",
  "được",
  "rằng",
  "này",
  "kia",
  "đó",
]);

const FRESHNESS_HINTS = new Set([
  "current",
  "currently",
  "latest",
  "recent",
  "recently",
  "today",
  "updated",
  "update",
  "yesterday",
  "newest",
  // Vietnamese
  "mới",
  "nhất",
  "hôm",
  "nay",
  "qua",
  "gần",
  "đây",
  "cập",
  "nhật",
]);

const QUESTION_WORDS = [
  "how",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "can",
  "does",
  // Vietnamese
  "sao",
  "gì",
  "khi",
  "nào",
  "đâu",
  "ai",
  "thế",
];
const METADATA_TERM_KEYS = new Set([
  "tag",
  "tags",
  "label",
  "labels",
  "keyword",
  "keywords",
  "category",
  "categories",
  "product",
  "products",
]);

export function clamp01(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(1, value));
}

export function normalizeWhitespace(input: string) {
  return input.normalize("NFKC").replace(/\s+/g, " ").trim();
}

export function normalizeQuotedQuery(input: string) {
  const normalized = normalizeWhitespace(
    input
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/[^\p{L}\p{N}\s\-_/.:"]/gu, " "),
  );
  const quoteCount = normalized.split('"').length - 1;
  if (quoteCount % 2 === 1) {
    return normalized.replace(/"/g, " ").replace(/\s+/g, " ").trim();
  }

  return normalized;
}

export function extractQuotedPhrases(input: string) {
  const phrases: string[] = [];
  const normalized = normalizeQuotedQuery(input).toLowerCase();
  const matches = normalized.matchAll(/"([^"]+)"/g);

  for (const match of matches) {
    const phrase = match[1]?.replace(/\s+/g, " ").trim();
    if (phrase && phrase.length >= 2) {
      phrases.push(phrase);
    }
  }

  return dedupeOrdered(phrases);
}

export function extractMatchingTerms(input: string) {
  const normalized = normalizeQuotedQuery(input)
    .toLowerCase()
    .replace(/"/g, " ");

  return dedupeOrdered(
    normalized
      .split(/\s+/)
      .map((token) => token.trim())
      .map((token) => token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
      .filter((token) => token.length >= 2)
      .filter((token) => !MATCH_STOP_WORDS.has(token)),
  );
}

export function dedupeOrdered<T>(items: T[]) {
  return Array.from(new Set(items));
}

export function detectFreshnessIntent(tokens: string[], phrases: string[]) {
  return (
    tokens.some((token) => FRESHNESS_HINTS.has(token)) ||
    phrases.some(
      (phrase) => phrase === "last updated" || phrase === "most recent",
    )
  );
}

export function detectQuestionLikeQuery(rawQuery: string, tokens: string[]) {
  const normalizedRaw = rawQuery.trim().toLowerCase();
  return (
    normalizedRaw.includes("?") ||
    QUESTION_WORDS.some((word) => tokens[0] === word)
  );
}

export function normalizeSemanticDistance(distance: number | null | undefined) {
  if (!Number.isFinite(distance)) {
    return 0;
  }

  return clamp01(1 - Number(distance) / 2);
}

export function normalizeLexicalRank(rawRank: number | null | undefined) {
  if (!Number.isFinite(rawRank) || Number(rawRank) <= 0) {
    return 0;
  }

  return clamp01(Number(rawRank) / (Number(rawRank) + 1));
}

export function normalizeTextForMatch(input: string | null | undefined) {
  return normalizeWhitespace(input ?? "").toLowerCase();
}

export function computeTokenCoverage(
  haystack: string | null | undefined,
  tokens: string[],
) {
  if (!tokens.length) {
    return 0;
  }

  const haystackTerms = new Set(extractMatchingTerms(haystack ?? ""));
  if (!haystackTerms.size) {
    return 0;
  }

  const matched = tokens.filter((token) => haystackTerms.has(token));
  return matched.length / tokens.length;
}

export function computePhraseCoverage(
  haystack: string | null | undefined,
  phrases: string[],
) {
  if (!phrases.length) {
    return 0;
  }

  const normalizedHaystack = normalizeTextForMatch(haystack);
  if (!normalizedHaystack) {
    return 0;
  }

  const matched = phrases.filter((phrase) =>
    normalizedHaystack.includes(phrase),
  );
  return matched.length / phrases.length;
}

export function computeRecencyScore(
  indexedAt: Date | null,
  freshnessIntent: boolean,
) {
  if (!indexedAt || !freshnessIntent) {
    return 0;
  }

  const ageDays = Math.max(0, (Date.now() - indexedAt.getTime()) / 86_400_000);
  return clamp01(1 / (1 + ageDays / 180));
}

export function computeJaccard(
  left: string | null | undefined,
  right: string | null | undefined,
) {
  const leftTokens = new Set(extractMatchingTerms(left ?? ""));
  const rightTokens = new Set(extractMatchingTerms(right ?? ""));

  if (!leftTokens.size || !rightTokens.size) {
    return 0;
  }

  let intersection = 0;
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) {
      intersection += 1;
    }
  });

  return intersection / (leftTokens.size + rightTokens.size - intersection);
}

export function extractMetadataTerms(
  metadataJson: Record<string, unknown> | null | undefined,
) {
  if (!metadataJson || typeof metadataJson !== "object") {
    return [];
  }

  const terms: string[] = [];

  Object.entries(metadataJson).forEach(([key, value]) => {
    if (!METADATA_TERM_KEYS.has(key.toLowerCase())) {
      return;
    }

    if (typeof value === "string") {
      terms.push(...extractMatchingTerms(value));
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((entry) => {
        if (typeof entry === "string") {
          terms.push(...extractMatchingTerms(entry));
        }
      });
    }
  });

  return dedupeOrdered(terms);
}

export function isFaqLikeChunk(params: {
  sectionTitle?: string | null;
  sourceTitle?: string | null;
  content?: string | null;
}) {
  const title =
    `${params.sectionTitle ?? ""} ${params.sourceTitle ?? ""}`.toLowerCase();
  const contentStart = normalizeTextForMatch(params.content).slice(0, 120);

  return (
    title.includes("faq") ||
    title.includes("frequently asked") ||
    title.includes("?") ||
    contentStart.startsWith("q:") ||
    contentStart.startsWith("question:")
  );
}

export function roundScore(value: number) {
  return Number(clamp01(value).toFixed(6));
}
