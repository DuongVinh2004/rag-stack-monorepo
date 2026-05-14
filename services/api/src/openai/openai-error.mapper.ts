import {
  APIConnectionError,
  APIConnectionTimeoutError,
  AuthenticationError,
  BadRequestError,
  ConflictError,
  InternalServerError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
  UnprocessableEntityError,
} from 'openai';
import { OpenAiGatewayError, OpenAiRequestType } from './openai.types';

export function mapOpenAiError(
  error: unknown,
  params: {
    requestType: OpenAiRequestType;
    model?: string;
    latencyMs?: number;
  },
) {
  const metadata = {
    latencyMs: params.latencyMs,
    model: params.model,
  };

  if (error instanceof OpenAiGatewayError) {
    return error;
  }

  if (error instanceof AuthenticationError || error instanceof PermissionDeniedError) {
    return new OpenAiGatewayError({
      code: 'OPENAI_AUTH_ERROR',
      message: 'OpenAI authentication failed',
      requestType: params.requestType,
      retryable: false,
      metadata: {
        ...metadata,
        providerStatus: Number((error as { status?: number }).status ?? 401),
      },
      cause: error,
    });
  }

  if (error instanceof RateLimitError) {
    return new OpenAiGatewayError({
      code: 'OPENAI_RATE_LIMIT',
      message: 'OpenAI rate limit exceeded',
      requestType: params.requestType,
      retryable: true,
      metadata: {
        ...metadata,
        providerStatus: Number((error as { status?: number }).status ?? 429),
      },
      cause: error,
    });
  }

  if (error instanceof APIConnectionTimeoutError) {
    return new OpenAiGatewayError({
      code: 'OPENAI_TIMEOUT',
      message: 'OpenAI request timed out',
      requestType: params.requestType,
      retryable: true,
      metadata,
      cause: error,
    });
  }

  if (error instanceof APIConnectionError || error instanceof InternalServerError) {
    return new OpenAiGatewayError({
      code: 'OPENAI_TRANSIENT_ERROR',
      message: 'OpenAI request failed with a transient error',
      requestType: params.requestType,
      retryable: true,
      metadata: {
        ...metadata,
        providerStatus:
          error instanceof InternalServerError
            ? Number((error as { status?: number }).status ?? 500)
            : undefined,
      },
      cause: error,
    });
  }

  if (
    error instanceof BadRequestError ||
    error instanceof UnprocessableEntityError ||
    error instanceof ConflictError ||
    error instanceof NotFoundError
  ) {
    return new OpenAiGatewayError({
      code: 'OPENAI_INVALID_REQUEST',
      message: 'OpenAI rejected the request',
      requestType: params.requestType,
      retryable: false,
      metadata: {
        ...metadata,
        providerStatus: Number((error as { status?: number }).status ?? 400),
      },
      cause: error,
    });
  }

  return new OpenAiGatewayError({
    code: 'OPENAI_TRANSIENT_ERROR',
    message: 'OpenAI request failed unexpectedly',
    requestType: params.requestType,
    retryable: true,
    metadata,
    cause: error,
  });
}
