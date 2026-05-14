import type { ChatCompletion } from 'openai/resources/chat/completions';
import { Injectable } from '@nestjs/common';
import { getCitationLimit } from '../chat/chat.constants';
import { GroundedPrompt, ModelAnswer } from '../chat/chat.types';
import { TracingService } from '../common/observability/tracing.service';
import { OpenAiClientService } from './openai-client.service';
import { OpenAiConfigService } from './openai-config.service';
import { mapOpenAiError } from './openai-error.mapper';
import { OpenAiObservabilityService } from './openai-observability.service';
import { OpenAiUsageMapperService } from './openai-usage.mapper.service';
import {
  GroundedAnswerResult,
  OpenAiGatewayError,
  OpenAiRequestContext,
} from './openai.types';

const GROUNDED_CHAT_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: {
      type: 'string',
      enum: ['grounded', 'insufficient_data', 'out_of_scope'],
    },
    answer: {
      type: 'string',
      minLength: 1,
      maxLength: 4000,
    },
    used_chunk_ids: {
      type: 'array',
      maxItems: getCitationLimit(),
      items: { type: 'string' },
    },
  },
  required: ['status', 'answer', 'used_chunk_ids'],
};

@Injectable()
export class OpenAiGroundedChatService {
  constructor(
    private readonly config: OpenAiConfigService,
    private readonly client: OpenAiClientService,
    private readonly usageMapper: OpenAiUsageMapperService,
    private readonly observability: OpenAiObservabilityService,
    private readonly tracing: TracingService,
  ) {}

  async createGroundedAnswer(
    prompt: GroundedPrompt,
    context: OpenAiRequestContext,
  ): Promise<GroundedAnswerResult> {
    const modelConfig = this.config.chatModelConfig;
    if (!modelConfig.featureEnabled) {
      throw new OpenAiGatewayError({
        code: 'OPENAI_CHAT_FAILED',
        message: 'Grounded chat is disabled by configuration',
        requestType: context.requestType,
        retryable: false,
        metadata: {
          model: modelConfig.model,
        },
      });
    }

    if (!modelConfig.available) {
      throw new OpenAiGatewayError({
        code: 'OPENAI_CHAT_FAILED',
        message: 'Grounded chat is unavailable because OPENAI_API_KEY is missing',
        requestType: context.requestType,
        retryable: false,
        metadata: {
          model: modelConfig.model,
        },
      });
    }

    const startedAt = Date.now();
    const span = this.tracing.startSpan('openai.grounded_chat', {
      correlationId: context.correlationId ?? null,
      groundingChunkCount: context.batchSize ?? null,
      model: modelConfig.model,
      requestType: context.requestType,
    });

    try {
      const result = await this.client.createChatCompletion(
        {
          model: modelConfig.model,
          messages: [
            { role: 'system', content: prompt.instructions },
            { role: 'user', content: prompt.input },
          ],
          temperature: modelConfig.temperature,
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'grounded_answer',
              strict: true,
              schema: GROUNDED_CHAT_OUTPUT_SCHEMA,
            },
          },
        },
        {
          ...context,
          model: modelConfig.model,
        },
      );

      const latencyMs = Date.now() - startedAt;
      const completionResponse = result.response as unknown as ChatCompletion;
      const outputText = String(completionResponse.choices[0]?.message?.content ?? '').trim();
      if (!outputText) {
        throw new OpenAiGatewayError({
          code: 'OPENAI_RESPONSE_EMPTY',
          message: 'OpenAI returned an empty grounded response',
          requestType: context.requestType,
          retryable: false,
          metadata: {
            attempts: result.attempts,
            latencyMs,
            model: modelConfig.model,
          },
        });
      }

      const answer = this.parseGroundedAnswer(outputText, context.requestType, latencyMs, modelConfig.model);
      const usage = this.usageMapper.map(completionResponse.usage);
      this.observability.recordSuccess({
        context,
        latencyMs,
        model: modelConfig.model,
        usage,
        attempts: result.attempts,
      });
      span.end({
        attempts: result.attempts,
        latencyMs,
        outputStatus: answer.status,
        status: 'success',
      });

      return {
        answer,
        usage,
        model: modelConfig.model,
        latencyMs,
      };
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      const mapped = mapOpenAiError(error, {
        requestType: context.requestType,
        model: modelConfig.model,
        latencyMs,
      });
      mapped.metadata.attempts = mapped.metadata.attempts ?? 1;
      mapped.metadata.latencyMs = latencyMs;
      mapped.metadata.model = modelConfig.model;

      this.observability.recordFailure({
        context,
        latencyMs,
        model: modelConfig.model,
        errorCode: mapped.code,
        attempts: mapped.metadata.attempts,
      });
      span.recordException(mapped);
      span.end({
        attempts: mapped.metadata.attempts,
        errorCode: mapped.code,
        latencyMs,
        status: 'failed',
      });
      throw mapped;
    }
  }

  private parseGroundedAnswer(
    outputText: string,
    requestType: OpenAiRequestContext['requestType'],
    latencyMs: number,
    model: string,
  ): ModelAnswer {
    let parsed: {
      status?: string;
      answer?: unknown;
      used_chunk_ids?: unknown;
    };

    try {
      parsed = JSON.parse(outputText) as typeof parsed;
    } catch (error) {
      throw new OpenAiGatewayError({
        code: 'OPENAI_CHAT_FAILED',
        message: 'OpenAI returned malformed grounded output',
        requestType,
        retryable: false,
        metadata: {
          latencyMs,
          model,
        },
        cause: error,
      });
    }

    if (
      !['grounded', 'insufficient_data', 'out_of_scope'].includes(String(parsed.status)) ||
      typeof parsed.answer !== 'string' ||
      !Array.isArray(parsed.used_chunk_ids) ||
      !parsed.used_chunk_ids.every((chunkId) => typeof chunkId === 'string')
    ) {
      throw new OpenAiGatewayError({
        code: 'OPENAI_CHAT_FAILED',
        message: 'OpenAI returned invalid grounded output fields',
        requestType,
        retryable: false,
        metadata: {
          latencyMs,
          model,
        },
      });
    }

    const answer = parsed.answer.trim();
    if (!answer) {
      throw new OpenAiGatewayError({
        code: 'OPENAI_CHAT_FAILED',
        message: 'OpenAI returned a blank grounded answer',
        requestType,
        retryable: false,
        metadata: {
          latencyMs,
          model,
        },
      });
    }

    const normalizedChunkIds =
      parsed.status === 'grounded'
        ? [...new Set(parsed.used_chunk_ids.map((chunkId) => chunkId.trim()).filter(Boolean))].slice(
            0,
            getCitationLimit(),
          )
        : [];

    return {
      status: parsed.status as ModelAnswer['status'],
      answer,
      usedChunkIds: normalizedChunkIds,
    };
  }
}
