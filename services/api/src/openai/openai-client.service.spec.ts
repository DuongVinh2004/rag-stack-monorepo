import { BadRequestError, RateLimitError } from 'openai';
import { OpenAiClientService } from './openai-client.service';

const errorOf = <T extends new (...args: any[]) => Error>(
  klass: T,
  properties?: Record<string, unknown>,
) =>
  Object.assign(Object.create(klass.prototype), {
    message: 'test error',
    ...properties,
  });

describe('OpenAiClientService', () => {
  it('retries retryable provider errors and returns the final response', async () => {
    const embeddingsCreate = jest
      .fn()
      .mockRejectedValueOnce(errorOf(RateLimitError, { status: 429 }))
      .mockResolvedValueOnce({
        data: [{ embedding: [0.1, 0.2] }],
        usage: {
          total_tokens: 4,
        },
      });
    const service = new OpenAiClientService({
      createClient: jest.fn(() => ({
        embeddings: { create: embeddingsCreate },
        responses: { create: jest.fn() },
      })),
      retryPolicy: {
        maxRetries: 2,
        baseDelayMs: 0,
      },
    } as any);

    await expect(
      service.createEmbedding(
        {
          model: 'text-embedding-3-small',
          input: 'reset worker',
        },
        {
          model: 'text-embedding-3-small',
          requestType: 'query_embedding',
        },
      ),
    ).resolves.toMatchObject({
      attempts: 2,
      response: expect.objectContaining({
        data: expect.any(Array),
      }),
    });
    expect(embeddingsCreate).toHaveBeenCalledTimes(2);
  });

  it('does not retry invalid requests', async () => {
    const embeddingsCreate = jest
      .fn()
      .mockRejectedValue(errorOf(BadRequestError, { status: 400 }));
    const service = new OpenAiClientService({
      createClient: jest.fn(() => ({
        embeddings: { create: embeddingsCreate },
        responses: { create: jest.fn() },
      })),
      retryPolicy: {
        maxRetries: 3,
        baseDelayMs: 0,
      },
    } as any);

    await expect(
      service.createEmbedding(
        {
          model: 'text-embedding-3-small',
          input: 'reset worker',
        },
        {
          model: 'text-embedding-3-small',
          requestType: 'query_embedding',
        },
      ),
    ).rejects.toMatchObject({
      code: 'OPENAI_INVALID_REQUEST',
      retryable: false,
    });
    expect(embeddingsCreate).toHaveBeenCalledTimes(1);
  });
});
