import { OpenAiConfigService } from './openai-config.service';

describe('OpenAiConfigService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_EMBEDDINGS_ENABLED;
    delete process.env.OPENAI_GROUNDED_CHAT_ENABLED;
    delete process.env.OPENAI_REQUEST_TIMEOUT_MS;
    delete process.env.OPENAI_MAX_RETRIES;
    delete process.env.OPENAI_RETRY_BASE_DELAY_MS;
    delete process.env.OPENAI_GROUNDED_CHAT_MAX_CHUNKS;
    delete process.env.OPENAI_TEMPERATURE;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('uses safe defaults and reports unavailable features when the API key is missing', () => {
    const service = new OpenAiConfigService();

    expect(service.hasApiKey).toBe(false);
    expect(service.queryEmbeddingsEnabled).toBe(true);
    expect(service.queryEmbeddingsAvailable).toBe(false);
    expect(service.groundedChatEnabled).toBe(true);
    expect(service.groundedChatAvailable).toBe(false);
    expect(service.timeoutMs).toBe(30000);
    expect(service.retries).toBe(2);
    expect(service.retryPolicy).toEqual({
      maxRetries: 2,
      baseDelayMs: 250,
    });
    expect(service.maxGroundingChunks).toBe(6);
    expect(service.chatTemperature).toBe(0.1);
  });

  it('honors feature flags and explicit runtime values', () => {
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.OPENAI_EMBEDDINGS_ENABLED = 'false';
    process.env.OPENAI_GROUNDED_CHAT_ENABLED = 'true';
    process.env.OPENAI_REQUEST_TIMEOUT_MS = '45000';
    process.env.OPENAI_MAX_RETRIES = '4';
    process.env.OPENAI_RETRY_BASE_DELAY_MS = '500';
    process.env.OPENAI_GROUNDED_CHAT_MAX_CHUNKS = '4';
    process.env.OPENAI_TEMPERATURE = '0.2';

    const service = new OpenAiConfigService();

    expect(service.hasApiKey).toBe(true);
    expect(service.queryEmbeddingsEnabled).toBe(false);
    expect(service.queryEmbeddingsAvailable).toBe(false);
    expect(service.groundedChatAvailable).toBe(true);
    expect(service.timeoutMs).toBe(45000);
    expect(service.retries).toBe(4);
    expect(service.retryPolicy).toEqual({
      maxRetries: 4,
      baseDelayMs: 500,
    });
    expect(service.maxGroundingChunks).toBe(4);
    expect(service.chatTemperature).toBe(0.2);
  });

  it('fails fast on invalid retry configuration', () => {
    process.env.OPENAI_MAX_RETRIES = '8';

    expect(() => new OpenAiConfigService()).toThrow(
      'Environment variable OPENAI_MAX_RETRIES must be an integer between 0 and 5',
    );
  });
});
