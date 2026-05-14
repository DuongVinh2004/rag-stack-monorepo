import { OpenAiClientService } from './openai-client.service';
import { OpenAiConfigService } from './openai-config.service';
import { OpenAiGroundedChatService } from './openai-grounded-chat.service';
import { OpenAiObservabilityService } from './openai-observability.service';
import { OpenAiUsageMapperService } from './openai-usage.mapper.service';

describe('OpenAiGroundedChatService', () => {
  const tracing = {
    startSpan: jest.fn().mockReturnValue({
      recordException: jest.fn(),
      end: jest.fn(),
    }),
  } as any;

  const createService = (overrides?: Partial<OpenAiConfigService>) => {
    const config = {
      chatModelConfig: {
        provider: 'openai',
        operation: 'chat',
        model: 'gpt-5',
        timeoutMs: 30000,
        retryPolicy: {
          maxRetries: 2,
          baseDelayMs: 0,
        },
        featureEnabled: true,
        available: true,
        temperature: 0.1,
        maxGroundingChunks: 6,
      },
      ...overrides,
    } as any;
    const client = {
      createResponse: jest.fn(),
    } as any;
    const observability = {
      recordSuccess: jest.fn(),
      recordFailure: jest.fn(),
    } as any;

    return {
      config,
      client,
      observability,
      service: new OpenAiGroundedChatService(
        config,
        client as OpenAiClientService,
        new OpenAiUsageMapperService(),
        observability as OpenAiObservabilityService,
        tracing,
      ),
    };
  };

  it('passes prompt assembly output through to the client without rebuilding it', async () => {
    const { service, client } = createService();
    client.createResponse.mockResolvedValue({
      attempts: 1,
      response: {
        output_text:
          '{"status":"grounded","answer":"Reset the worker before retrying.","used_chunk_ids":["chunk-1","chunk-1"]}',
        usage: {
          input_tokens: 20,
          output_tokens: 8,
          total_tokens: 28,
        },
      },
    });

    const prompt = {
      instructions: 'Use only the retrieved context.',
      input: 'Question: How do I reset the worker?',
    };

    await expect(
      service.createGroundedAnswer(prompt, {
        requestType: 'grounded_chat',
        batchSize: 2,
      }),
    ).resolves.toMatchObject({
      answer: {
        status: 'grounded',
        answer: 'Reset the worker before retrying.',
        usedChunkIds: ['chunk-1'],
      },
      usage: {
        inputTokens: 20,
        outputTokens: 8,
        totalTokens: 28,
      },
      model: 'gpt-5',
    });
    expect(client.createResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        instructions: prompt.instructions,
        input: prompt.input,
        model: 'gpt-5',
        temperature: 0.1,
        store: false,
      }),
      expect.objectContaining({
        model: 'gpt-5',
        requestType: 'grounded_chat',
      }),
    );
  });

  it('rejects malformed model output instead of returning partial data', async () => {
    const { service, client, observability } = createService();
    client.createResponse.mockResolvedValue({
      attempts: 1,
      response: {
        output_text: '{"status":"grounded","answer":42,"used_chunk_ids":["chunk-1"]}',
        usage: {
          input_tokens: 10,
          output_tokens: 2,
          total_tokens: 12,
        },
      },
    });

    await expect(
      service.createGroundedAnswer(
        {
          instructions: 'Use only the retrieved context.',
          input: 'Question: How do I reset the worker?',
        },
        {
          requestType: 'grounded_chat',
          batchSize: 2,
        },
      ),
    ).rejects.toMatchObject({
      code: 'OPENAI_CHAT_FAILED',
    });
    expect(observability.recordFailure).toHaveBeenCalledTimes(1);
  });
});
