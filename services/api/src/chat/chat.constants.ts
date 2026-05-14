export const DEFAULT_RETRIEVAL_CANDIDATE_LIMIT = 24;
export const DEFAULT_RETRIEVAL_RERANK_LIMIT = 24;
export const DEFAULT_RETRIEVAL_GROUNDING_LIMIT = 6;
export const DEFAULT_CITATION_LIMIT = 3;
export const DEFAULT_CONVERSATION_MESSAGE_LIMIT = 20;
export const DEFAULT_PROMPT_HISTORY_LIMIT = 6;
export const CHAT_PROMPT_VERSION = "grounded_v1";
export const CITATION_POLICY_VERSION = "answer_level_v1";
export const LOW_EVIDENCE_SCORE_THRESHOLD = 0.1;
export const LOW_EVIDENCE_SCORE_THRESHOLD_LEXICAL_ONLY = 0.02;
export const GROUNDABLE_EVIDENCE_SCORE_THRESHOLD = 0.2;
export const MAX_CITATION_SNIPPET_LENGTH = 280;
export const MIN_CITATION_SUPPORT_SCORE = 0.1;

export const HYBRID_SCORE_WEIGHTS = {
  semantic: 0.4,
  lexical: 0.4,
  metadata: 0.1,
  recency: 0.03,
  structural: 0.07,
} as const;

export const getRetrievalCandidateLimit = () =>
  readPositiveIntEnv(
    "CHAT_RETRIEVAL_CANDIDATE_LIMIT",
    DEFAULT_RETRIEVAL_CANDIDATE_LIMIT,
  );

export const getRetrievalSemanticCandidateLimit = () =>
  readPositiveIntEnv(
    "CHAT_RETRIEVAL_SEMANTIC_CANDIDATE_LIMIT",
    getRetrievalCandidateLimit(),
  );

export const getRetrievalLexicalCandidateLimit = () =>
  readPositiveIntEnv(
    "CHAT_RETRIEVAL_LEXICAL_CANDIDATE_LIMIT",
    getRetrievalCandidateLimit(),
  );

export const getRetrievalRerankLimit = () =>
  readPositiveIntEnv(
    "CHAT_RETRIEVAL_RERANK_LIMIT",
    DEFAULT_RETRIEVAL_RERANK_LIMIT,
  );

export const getRetrievalGroundingLimit = () =>
  readPositiveIntEnv(
    "CHAT_RETRIEVAL_GROUNDING_LIMIT",
    DEFAULT_RETRIEVAL_GROUNDING_LIMIT,
  );

export const getCitationLimit = () =>
  readPositiveIntEnv("CHAT_CITATION_LIMIT", DEFAULT_CITATION_LIMIT);

export const getConversationMessageLimit = () =>
  readPositiveIntEnv(
    "CHAT_CONVERSATION_MESSAGE_LIMIT",
    DEFAULT_CONVERSATION_MESSAGE_LIMIT,
  );

export const getPromptHistoryLimit = () =>
  readPositiveIntEnv("CHAT_PROMPT_HISTORY_LIMIT", DEFAULT_PROMPT_HISTORY_LIMIT);

function readPositiveIntEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}
