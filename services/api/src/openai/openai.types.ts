import OpenAI from 'openai';
import { ModelAnswer, UsageView } from '../chat/chat.types';

export type OpenAiRequestType =
  | 'query_embedding'
  | 'grounded_chat'
  | 'eval_grounded_chat';

export type OpenAiOperation = 'embedding' | 'chat';

export type OpenAiErrorCode =
  | 'OPENAI_AUTH_ERROR'
  | 'OPENAI_RATE_LIMIT'
  | 'OPENAI_TIMEOUT'
  | 'OPENAI_TRANSIENT_ERROR'
  | 'OPENAI_INVALID_REQUEST'
  | 'OPENAI_RESPONSE_EMPTY'
  | 'OPENAI_EMBEDDING_FAILED'
  | 'OPENAI_CHAT_FAILED';

export type OpenAiDisabledReason = 'feature_disabled' | 'api_key_missing';

export interface OpenAiRetryPolicy {
  maxRetries: number;
  baseDelayMs: number;
}

export interface OpenAiModelConfig {
  provider: 'openai';
  operation: OpenAiOperation;
  model: string;
  timeoutMs: number;
  retryPolicy: OpenAiRetryPolicy;
}

export interface OpenAiEmbeddingModelConfig extends OpenAiModelConfig {
  operation: 'embedding';
  featureEnabled: boolean;
  available: boolean;
}

export interface OpenAiChatModelConfig extends OpenAiModelConfig {
  operation: 'chat';
  featureEnabled: boolean;
  available: boolean;
  temperature: number;
  maxGroundingChunks: number;
}

export interface OpenAiUsage extends UsageView {
  cachedInputTokens: number;
  reasoningTokens: number;
}

export interface OpenAiRequestContext {
  requestType: OpenAiRequestType;
  correlationId?: string;
  batchSize?: number;
  kbId?: string;
}

export interface OpenAiClientInvocation {
  model: string;
  requestType: OpenAiRequestType;
  correlationId?: string;
  batchSize?: number;
  kbId?: string;
}

export interface OpenAiClientResult<TResponse> {
  attempts: number;
  response: TResponse;
}

export type OpenAiEmbeddingRequest = Parameters<OpenAI['embeddings']['create']>[0];
export type OpenAiEmbeddingResponse = Awaited<
  ReturnType<OpenAI['embeddings']['create']>
>;
export type OpenAiResponseRequest = Parameters<OpenAI['chat']['completions']['create']>[0];
export type OpenAiResponseResponse = Awaited<
  ReturnType<OpenAI['chat']['completions']['create']>
>;

export type QueryEmbeddingResult =
  | {
      status: 'disabled';
      reason: OpenAiDisabledReason;
      model: string;
      usage: OpenAiUsage;
      latencyMs: number;
      dimensions: null;
      embedding: null;
      errorCode: null;
    }
  | {
      status: 'failed';
      reason: 'provider_error';
      model: string;
      usage: OpenAiUsage;
      latencyMs: number;
      dimensions: null;
      embedding: null;
      errorCode: OpenAiErrorCode;
    }
  | {
      status: 'success';
      model: string;
      usage: OpenAiUsage;
      latencyMs: number;
      dimensions: number;
      embedding: number[];
      errorCode: null;
    };

export interface GroundedAnswerResult {
  answer: ModelAnswer;
  usage: OpenAiUsage;
  model: string;
  latencyMs: number;
}

export interface OpenAiSafeErrorMetadata {
  model?: string;
  latencyMs?: number;
  providerStatus?: number;
  attempts?: number;
}

export class OpenAiGatewayError extends Error {
  readonly code: OpenAiErrorCode;
  readonly requestType: OpenAiRequestType;
  readonly retryable: boolean;
  readonly metadata: OpenAiSafeErrorMetadata;

  constructor(params: {
    code: OpenAiErrorCode;
    message: string;
    requestType: OpenAiRequestType;
    retryable: boolean;
    metadata?: OpenAiSafeErrorMetadata;
    cause?: unknown;
  }) {
    super(params.message);
    this.name = 'OpenAiGatewayError';
    this.code = params.code;
    this.requestType = params.requestType;
    this.retryable = params.retryable;
    this.metadata = params.metadata ?? {};
    if (params.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = params.cause;
    }
  }
}
