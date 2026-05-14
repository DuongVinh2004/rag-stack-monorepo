import { OpenAiUsageMapperService } from './openai-usage.mapper.service';

describe('OpenAiUsageMapperService', () => {
  it('maps responses API token usage including cached and reasoning tokens', () => {
    const service = new OpenAiUsageMapperService();

    expect(
      service.map({
        input_tokens: 25,
        output_tokens: 10,
        total_tokens: 35,
        input_tokens_details: {
          cached_tokens: 4,
        },
        output_tokens_details: {
          reasoning_tokens: 3,
        },
      }),
    ).toEqual({
      inputTokens: 25,
      outputTokens: 10,
      totalTokens: 35,
      cachedInputTokens: 4,
      reasoningTokens: 3,
    });
  });

  it('maps embeddings-style usage safely when usage is absent', () => {
    const service = new OpenAiUsageMapperService();

    expect(service.map(undefined)).toEqual(service.empty());
  });
});
