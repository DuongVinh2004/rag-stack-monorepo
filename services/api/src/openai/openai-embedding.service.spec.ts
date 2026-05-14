import { OpenAiConfigService } from './openai-config.service';
import { OpenAiClientService } from './openai-client.service';
import { OpenAiEmbeddingService } from './openai-embedding.service';
import { OpenAiGatewayError } from './openai.types';
import { OpenAiObservabilityService } from './openai-observability.service';
import { OpenAiUsageMapperService } from './openai-usage.mapper.service';

describe('OpenAiEmbeddingService', () => {
  const tracing = {
    startSpan: jest.fn().mockReturnValue({
      recordException: jest.fn(),
      end: jest.fn(),
    }),
  } as any;

  const createService = (overrides?: Partial<OpenAiConfigService>) => {
    const config = {
      embeddingModelConfig: {
        provider: 'openai',
        operation: 'embedding',
        model: 'text-embedding-3-small',
        timeoutMs: 30000,
        retryPolicy: {
          maxRetries: 2,
          baseDelayMs: 0,
        },
        featureEnabled: true,
        available: true,
      },
      retryPolicy: {
        maxRetries: 2,
        baseDelayMs: 0,
      },
      ...overrides,
    } as any;
    const client = {
      createEmbedding: jest.fn(),
    } as any;
    const usageMapper = new OpenAiUsageMapperService();
    const observability = {
      recordSuccess: jest.fn(),
      recordFailure: jest.fn(),
    } as any;

    return {
      config,
      client,
      observability,
      service: new OpenAiEmbeddingService(
        config,
        client as OpenAiClientService,
        usageMapper,
        observability as OpenAiObservabilityService,
        tracing,
      ),
    };
  };

  it('returns a disabled result when embeddings are feature-disabled', async () => {
    const { service } = createService({
      embeddingModelConfig: {
        provider: 'openai',
        operation: 'embedding',
        model: 'text-embedding-3-small',
        timeoutMs: 30000,
        retryPolicy: {
          maxRetries: 2,
          baseDelayMs: 0,
        },
        featureEnabled: false,
        available: false,
      },
    } as any);

    await expect(
      service.createQueryEmbedding('reset worker', {
        requestType: 'query_embedding',
      }),
    ).resolves.toMatchObject({
      status: 'disabled',
      reason: 'feature_disabled',
    });
  });

  it('maps successful query embeddings into a typed result', async () => {
    const { service, client, observability } = createService();
    client.createEmbedding.mockResolvedValue({
      attempts: 1,
      response: {
        data: [{ embedding: [0.1, 0.2, 0.3] }],
        usage: {
          prompt_tokens: 7,
          total_tokens: 7,
        },
      },
    });

    await expect(
      service.createQueryEmbedding('reset worker', {
        requestType: 'query_embedding',
      }),
    ).resolves.toEqual({
      status: 'success',
      model: 'text-embedding-3-small',
      usage: {
        inputTokens: 7,
        outputTokens: 0,
        totalTokens: 7,
        cachedInputTokens: 0,
        reasoningTokens: 0,
      },
      latencyMs: expect.any(Number),
      dimensions: 3,
      embedding: [0.1, 0.2, 0.3],
      errorCode: null,
    });
    expect(observability.recordSuccess).toHaveBeenCalledTimes(1);
  });

  it('returns a failed result instead of throwing when query embedding generation fails', async () => {
    const { service, client, observability } = createService();
    client.createEmbedding.mockRejectedValue(
      new OpenAiGatewayError({
        code: 'OPENAI_RATE_LIMIT',
        message: 'slow down',
        requestType: 'query_embedding',
        retryable: true,
        metadata: {
          attempts: 2,
        },
      }),
    );

    await expect(
      service.createQueryEmbedding('reset worker', {
        requestType: 'query_embedding',
      }),
    ).resolves.toMatchObject({
      status: 'failed',
      errorCode: 'OPENAI_RATE_LIMIT',
      reason: 'provider_error',
    });
    expect(observability.recordFailure).toHaveBeenCalledTimes(1);
  });
});
