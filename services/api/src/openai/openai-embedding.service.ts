import { Injectable } from '@nestjs/common';
import { TracingService } from '../common/observability/tracing.service';
import { OpenAiClientService } from './openai-client.service';
import { OpenAiConfigService } from './openai-config.service';
import { mapOpenAiError } from './openai-error.mapper';
import { OpenAiObservabilityService } from './openai-observability.service';
import { OpenAiUsageMapperService } from './openai-usage.mapper.service';
import {
  OpenAiGatewayError,
  OpenAiRequestContext,
  QueryEmbeddingResult,
} from './openai.types';

@Injectable()
export class OpenAiEmbeddingService {
  constructor(
    private readonly config: OpenAiConfigService,
    private readonly client: OpenAiClientService,
    private readonly usageMapper: OpenAiUsageMapperService,
    private readonly observability: OpenAiObservabilityService,
    private readonly tracing: TracingService,
  ) {}

  async createQueryEmbedding(
    query: string,
    context: Omit<OpenAiRequestContext, 'batchSize'>,
  ): Promise<QueryEmbeddingResult> {
    const requestContext = {
      ...context,
      batchSize: 1,
    };
    const modelConfig = this.config.embeddingModelConfig;

    if (!modelConfig.featureEnabled) {
      return this.buildDisabledResult('feature_disabled');
    }

    if (!modelConfig.available) {
      return this.buildDisabledResult('api_key_missing');
    }

    const startedAt = Date.now();
    const span = this.tracing.startSpan('openai.query_embedding', {
      correlationId: requestContext.correlationId ?? null,
      model: modelConfig.model,
      requestType: requestContext.requestType,
    });

    try {
      const result = await this.client.createEmbedding(
        {
          model: modelConfig.model,
          input: query,
        },
        {
          ...requestContext,
          model: modelConfig.model,
        },
      );
      const latencyMs = Date.now() - startedAt;
      const embedding = result.response.data[0]?.embedding;
      if (!embedding?.length) {
        throw new OpenAiGatewayError({
          code: 'OPENAI_EMBEDDING_FAILED',
          message: 'OpenAI returned no embedding vector',
          requestType: requestContext.requestType,
          retryable: false,
          metadata: {
            attempts: result.attempts,
            latencyMs,
            model: modelConfig.model,
          },
        });
      }

      const usage = this.usageMapper.map(result.response.usage);
      this.observability.recordSuccess({
        context: requestContext,
        latencyMs,
        model: modelConfig.model,
        usage,
        attempts: result.attempts,
      });
      span.end({
        attempts: result.attempts,
        dimensions: embedding.length,
        latencyMs,
        status: 'success',
      });

      return {
        status: 'success',
        model: modelConfig.model,
        usage,
        latencyMs,
        dimensions: embedding.length,
        embedding: [...embedding],
        errorCode: null,
      };
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      const mapped = mapOpenAiError(error, {
        requestType: requestContext.requestType,
        model: modelConfig.model,
        latencyMs,
      });
      mapped.metadata.attempts = mapped.metadata.attempts ?? 1;
      mapped.metadata.latencyMs = latencyMs;
      mapped.metadata.model = modelConfig.model;

      this.observability.recordFailure({
        context: requestContext,
        latencyMs,
        model: modelConfig.model,
        errorCode: mapped.code,
        attempts: mapped.metadata.attempts ?? 1,
      });
      span.recordException(mapped);
      span.end({
        attempts: mapped.metadata.attempts ?? 1,
        errorCode: mapped.code,
        latencyMs,
        status: 'failed',
      });

      return {
        status: 'failed',
        reason: 'provider_error',
        model: modelConfig.model,
        usage: this.usageMapper.empty(),
        latencyMs,
        dimensions: null,
        embedding: null,
        errorCode: mapped.code,
      };
    }
  }

  private buildDisabledResult(reason: 'feature_disabled' | 'api_key_missing'): QueryEmbeddingResult {
    return {
      status: 'disabled',
      reason,
      model: this.config.embeddingModelConfig.model,
      usage: this.usageMapper.empty(),
      latencyMs: 0,
      dimensions: null,
      embedding: null,
      errorCode: null,
    };
  }
}
