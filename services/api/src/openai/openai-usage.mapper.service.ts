import { Injectable } from '@nestjs/common';
import { OpenAiUsage } from './openai.types';

@Injectable()
export class OpenAiUsageMapperService {
  empty(): OpenAiUsage {
    return {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cachedInputTokens: 0,
      reasoningTokens: 0,
    };
  }

  map(usage: any): OpenAiUsage {
    return {
      inputTokens: Number(usage?.input_tokens ?? usage?.prompt_tokens ?? 0),
      outputTokens: Number(usage?.output_tokens ?? usage?.completion_tokens ?? 0),
      totalTokens: Number(usage?.total_tokens ?? 0),
      cachedInputTokens: Number(
        usage?.input_tokens_details?.cached_tokens ??
          usage?.prompt_tokens_details?.cached_tokens ??
          0,
      ),
      reasoningTokens: Number(
        usage?.output_tokens_details?.reasoning_tokens ??
          usage?.completion_tokens_details?.reasoning_tokens ??
          0,
      ),
    };
  }
}
