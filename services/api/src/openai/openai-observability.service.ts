import { Injectable, Logger } from '@nestjs/common';
import { MetricsService } from '../common/observability/metrics.service';
import { OpenAiRequestContext, OpenAiUsage } from './openai.types';

@Injectable()
export class OpenAiObservabilityService {
  private readonly logger = new Logger(OpenAiObservabilityService.name);

  constructor(private readonly metrics: MetricsService) {}

  recordSuccess(params: {
    context: OpenAiRequestContext;
    latencyMs: number;
    model: string;
    usage: OpenAiUsage;
    attempts: number;
  }) {
    this.metrics.increment('openai_requests_total', 1, {
      model: params.model,
      outcome: 'success',
      request_type: params.context.requestType,
    });
    this.metrics.recordDuration('openai_request_duration_ms', params.latencyMs, {
      model: params.model,
      outcome: 'success',
      request_type: params.context.requestType,
    });
    this.metrics.increment('openai_input_tokens_total', params.usage.inputTokens, {
      model: params.model,
      request_type: params.context.requestType,
    });
    this.metrics.increment('openai_output_tokens_total', params.usage.outputTokens, {
      model: params.model,
      request_type: params.context.requestType,
    });

    this.logger.log(
      JSON.stringify({
        attempts: params.attempts,
        batchSize: params.context.batchSize ?? null,
        cachedInputTokens: params.usage.cachedInputTokens,
        correlationId: params.context.correlationId ?? null,
        event: 'openai_request_completed',
        inputTokens: params.usage.inputTokens,
        kbId: params.context.kbId ?? null,
        latencyMs: params.latencyMs,
        model: params.model,
        outcome: 'success',
        outputTokens: params.usage.outputTokens,
        reasoningTokens: params.usage.reasoningTokens,
        requestType: params.context.requestType,
        totalTokens: params.usage.totalTokens,
      }),
    );
  }

  recordFailure(params: {
    context: OpenAiRequestContext;
    latencyMs: number;
    model: string;
    errorCode: string;
    attempts: number;
  }) {
    this.metrics.increment('openai_requests_total', 1, {
      error_code: params.errorCode,
      model: params.model,
      outcome: 'failure',
      request_type: params.context.requestType,
    });
    this.metrics.recordDuration('openai_request_duration_ms', params.latencyMs, {
      error_code: params.errorCode,
      model: params.model,
      outcome: 'failure',
      request_type: params.context.requestType,
    });

    this.logger.warn(
      JSON.stringify({
        attempts: params.attempts,
        batchSize: params.context.batchSize ?? null,
        correlationId: params.context.correlationId ?? null,
        errorCode: params.errorCode,
        event: 'openai_request_failed',
        kbId: params.context.kbId ?? null,
        latencyMs: params.latencyMs,
        model: params.model,
        outcome: 'failure',
        requestType: params.context.requestType,
      }),
    );
  }
}
