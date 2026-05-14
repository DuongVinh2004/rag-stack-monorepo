import { MessageRole } from "@prisma/client";
import { AuthenticatedUser } from "../common/authorization/authorization.types";

export type ChatStatus = "grounded" | "insufficient_data" | "out_of_scope";
export type EvidenceStrength = "low" | "medium" | "high";

export type ChatAuthenticatedUser = AuthenticatedUser;

export interface ChatFilters {
  documentIds?: string[];
  languages?: string[];
}

export type RetrievalSource = "semantic" | "lexical";

export interface NormalizedRetrievalQuery {
  rawQuery: string;
  normalizedText: string;
  lexicalText: string;
  tokens: string[];
  phrases: string[];
  freshnessIntent: boolean;
  questionLike: boolean;
}

export interface RetrievalScoreWeights {
  semantic: number;
  lexical: number;
  metadata: number;
  recency: number;
  structural: number;
}

export interface RetrievalCandidateDebug {
  retrievedBy: RetrievalSource[];
  rawSemanticDistance: number | null;
  rawSemanticSimilarity: number | null;
  rawLexicalScore: number | null;
  lexicalTokenCoverage: number;
  lexicalPhraseCoverage: number;
  metadataSignals: string[];
  structuralSignals: string[];
  selectionReason: string;
  rankBeforeDedup: number | null;
  rankAfterDedup: number | null;
  dedupReason: string | null;
}

export interface RetrievalCandidate {
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
  semanticScore: number;
  lexicalScore: number;
  recencyScore: number;
  metadataScore: number;
  structuralScore: number;
  hybridScore: number;
  semanticRank: number | null;
  lexicalRank: number | null;
  indexedAt: Date | null;
  debug: RetrievalCandidateDebug;
}

export interface RetrievalDebugCandidate {
  chunkId: string;
  documentId: string;
  semanticScore: number;
  lexicalScore: number;
  metadataMatchScore: number;
  recencyScore: number;
  structuralScore: number;
  finalScore: number;
  selectionReason: string;
  rankBeforeDedup: number | null;
  rankAfterDedup: number | null;
  retrievedBy: RetrievalSource[];
  semanticRank: number | null;
  lexicalRank: number | null;
  dedupReason: string | null;
}

export interface RetrievalDebugTimingView {
  embeddingMs: number;
  semanticFetchMs: number;
  lexicalFetchMs: number;
  mergeRerankMs: number;
  dedupMs: number;
  totalMs: number;
}

export interface RetrievalDebugView {
  query: {
    normalizedText: string;
    lexicalText: string;
    tokens: string[];
    phrases: string[];
    freshnessIntent: boolean;
  };
  limits: {
    semanticTopN: number;
    lexicalTopN: number;
    rerankPoolLimit: number;
    groundingTopK: number;
  };
  weights: RetrievalScoreWeights;
  timingsMs: RetrievalDebugTimingView;
  rankedCandidates: RetrievalDebugCandidate[];
}

export interface RetrievalResult {
  normalizedQuery: string;
  embeddingsEnabled: boolean;
  semanticUsed: boolean;
  lexicalUsed: boolean;
  totalCandidates: number;
  selectedChunks: RetrievalCandidate[];
  debug: RetrievalDebugView;
}

export interface RetrievalSelectionView {
  chunkId: string;
  score: number;
}

export interface RetrievalMetaView {
  correlationId: string | null;
  embeddingsEnabled: boolean;
  filters: ChatFilters;
  lexicalUsed: boolean;
  semanticUsed: boolean;
  totalCandidates: number;
  selectedChunks: RetrievalSelectionView[];
  normalizedQuery: string;
  topScore: number;
}

export interface PromptContextMessage {
  role: MessageRole;
  content: string;
}

export interface GroundedPrompt {
  instructions: string;
  input: string;
}

export interface ModelAnswer {
  status: ChatStatus;
  answer: string;
  usedChunkIds: string[];
}

export interface CitationView {
  rank: number;
  score: number;
  chunkId: string;
  documentId: string;
  documentTitle: string;
  snippet: string;
  page: number | null;
  section: string | null;
}

export type CitationGranularity = "answer_level";

export interface CitationAssemblyRejection {
  chunkId: string;
  reason: string;
}

export interface CitationAssemblyDebug {
  policyVersion: string;
  granularity: CitationGranularity;
  maxCitations: number;
  requestedChunkIds: string[];
  acceptedChunkIds: string[];
  rejectedChunkIds: CitationAssemblyRejection[];
}

export interface CitationAssemblyResult {
  citations: CitationView[];
  debug: CitationAssemblyDebug;
}

export interface UsageView {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface ChatResponseView {
  conversationId: string;
  messageId: string;
  answer: string;
  citations: CitationView[];
  usage: UsageView;
  latencyMs: number;
  status: ChatStatus;
}
