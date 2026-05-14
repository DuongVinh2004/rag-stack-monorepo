import {
  APIConnectionError,
  APIConnectionTimeoutError,
  AuthenticationError,
  BadRequestError,
  RateLimitError,
} from 'openai';
import { mapOpenAiError } from './openai-error.mapper';

const errorOf = <T extends new (...args: any[]) => Error>(
  klass: T,
  properties?: Record<string, unknown>,
) =>
  Object.assign(Object.create(klass.prototype), {
    message: 'test error',
    ...properties,
  });

describe('mapOpenAiError', () => {
  it('maps authentication failures to OPENAI_AUTH_ERROR', () => {
    const mapped = mapOpenAiError(errorOf(AuthenticationError, { status: 401 }), {
      requestType: 'grounded_chat',
      model: 'gpt-5',
      latencyMs: 12,
    });

    expect(mapped.code).toBe('OPENAI_AUTH_ERROR');
    expect(mapped.retryable).toBe(false);
    expect(mapped.metadata.providerStatus).toBe(401);
  });

  it('maps rate limits to retryable OPENAI_RATE_LIMIT', () => {
    const mapped = mapOpenAiError(errorOf(RateLimitError, { status: 429 }), {
      requestType: 'query_embedding',
      model: 'text-embedding-3-small',
      latencyMs: 8,
    });

    expect(mapped.code).toBe('OPENAI_RATE_LIMIT');
    expect(mapped.retryable).toBe(true);
  });

  it('maps timeouts to OPENAI_TIMEOUT', () => {
    const mapped = mapOpenAiError(errorOf(APIConnectionTimeoutError), {
      requestType: 'query_embedding',
      model: 'text-embedding-3-small',
      latencyMs: 99,
    });

    expect(mapped.code).toBe('OPENAI_TIMEOUT');
    expect(mapped.retryable).toBe(true);
  });

  it('maps invalid requests to OPENAI_INVALID_REQUEST', () => {
    const mapped = mapOpenAiError(errorOf(BadRequestError, { status: 400 }), {
      requestType: 'grounded_chat',
      model: 'gpt-5',
      latencyMs: 15,
    });

    expect(mapped.code).toBe('OPENAI_INVALID_REQUEST');
    expect(mapped.retryable).toBe(false);
  });

  it('maps connection issues to OPENAI_TRANSIENT_ERROR', () => {
    const mapped = mapOpenAiError(errorOf(APIConnectionError), {
      requestType: 'eval_grounded_chat',
      model: 'gpt-5',
      latencyMs: 40,
    });

    expect(mapped.code).toBe('OPENAI_TRANSIENT_ERROR');
    expect(mapped.retryable).toBe(true);
  });
});
