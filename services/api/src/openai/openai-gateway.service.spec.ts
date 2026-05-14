import { OpenAiGatewayService } from './openai-gateway.service';

describe('OpenAiGatewayService', () => {
  it('delegates embedding and grounded chat requests to the specialized services', async () => {
    const config = {
      groundedChatAvailable: true,
      chatModelConfig: {
        model: 'gpt-5',
        maxGroundingChunks: 6,
      },
      embeddingModelConfig: {
        model: 'text-embedding-3-small',
        available: true,
      },
      describe: jest.fn(() => ({ ok: true })),
    } as any;
    const embeddings = {
      createQueryEmbedding: jest.fn().mockResolvedValue({ status: 'disabled' }),
    } as any;
    const groundedChat = {
      createGroundedAnswer: jest.fn().mockResolvedValue({ model: 'gpt-5' }),
    } as any;

    const service = new OpenAiGatewayService(config, embeddings, groundedChat);

    expect(service.isConfigured).toBe(true);
    expect(service.configuredChatModel).toBe('gpt-5');
    expect(service.configuredEmbeddingModel).toBe('text-embedding-3-small');
    expect(service.maxGroundingChunks).toBe(6);
    expect(service.embeddingsEnabled).toBe(true);
    expect(service.featureSummary).toEqual({ ok: true });

    await service.createQueryEmbedding('reset worker', {
      requestType: 'query_embedding',
    });
    await service.createGroundedAnswer(
      {
        instructions: 'Use only the retrieved context.',
        input: 'Question: How do I reset the worker?',
      },
      {
        requestType: 'grounded_chat',
      },
    );

    expect(embeddings.createQueryEmbedding).toHaveBeenCalledTimes(1);
    expect(groundedChat.createGroundedAnswer).toHaveBeenCalledTimes(1);
  });
});
