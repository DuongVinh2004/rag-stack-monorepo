import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { OpenAiConfigService } from './openai-config.service';
import { mapOpenAiError } from './openai-error.mapper';
import {
  OpenAiClientInvocation,
  OpenAiClientResult,
  OpenAiEmbeddingRequest,
  OpenAiEmbeddingResponse,
  OpenAiGatewayError,
  OpenAiResponseRequest,
  OpenAiResponseResponse,
} from './openai.types';

@Injectable()
export class OpenAiClientService {
  private readonly logger = new Logger(OpenAiClientService.name);
  private client: OpenAI | null | undefined;

  constructor(private readonly config: OpenAiConfigService) {}

  async createEmbedding(
    request: OpenAiEmbeddingRequest,
    context: OpenAiClientInvocation,
  ): Promise<OpenAiClientResult<OpenAiEmbeddingResponse>> {
    return this.executeWithRetry(context, () =>
      this.requireClient(context.requestType).embeddings.create(request),
    );
  }

  async createChatCompletion(
    request: OpenAiResponseRequest,
    context: OpenAiClientInvocation,
  ): Promise<OpenAiClientResult<OpenAiResponseResponse>> {
    return this.executeWithRetry(context, () =>
      this.requireClient(context.requestType).chat.completions.create(request),
    );
  }

  private getClient() {
    if (this.client !== undefined) {
      return this.client;
    }

    this.client = this.config.createClient();
    return this.client;
  }

  private requireClient(requestType: OpenAiClientInvocation['requestType']) {
    const client = this.getClient();
    if (client) {
      return client;
    }

    throw new OpenAiGatewayError({
      code: 'OPENAI_AUTH_ERROR',
      message: 'OpenAI client is unavailable because OPENAI_API_KEY is missing',
      requestType,
      retryable: false,
    });
  }

  private async executeWithRetry<TResponse>(
    context: OpenAiClientInvocation,
    fn: () => Promise<TResponse>,
  ): Promise<OpenAiClientResult<TResponse>> {
    const maxAttempts = this.config.retryPolicy.maxRetries + 1;
    let attempt = 0;

    while (attempt < maxAttempts) {
      attempt += 1;

      try {
        const response = await fn();
        return {
          attempts: attempt,
          response,
        };
      } catch (error) {
        const mapped = mapOpenAiError(error, {
          requestType: context.requestType,
          model: context.model,
        });
        mapped.metadata.attempts = attempt;

        if (!mapped.retryable || attempt >= maxAttempts) {
          throw mapped;
        }

        const delayMs = this.computeRetryDelayMs(attempt);
        this.logger.warn(
          JSON.stringify({
            attempt,
            correlationId: context.correlationId ?? null,
            errorCode: mapped.code,
            event: 'openai_request_retry_scheduled',
            kbId: context.kbId ?? null,
            model: context.model,
            nextDelayMs: delayMs,
            requestType: context.requestType,
          }),
        );
        await this.sleep(delayMs);
      }
    }

    throw new OpenAiGatewayError({
      code: 'OPENAI_TRANSIENT_ERROR',
      message: 'OpenAI retry loop exited unexpectedly',
      requestType: context.requestType,
      retryable: true,
      metadata: {
        attempts: attempt,
        model: context.model,
      },
    });
  }

  private computeRetryDelayMs(attempt: number) {
    const baseDelayMs = this.config.retryPolicy.baseDelayMs;
    return Math.min(2000, baseDelayMs * 2 ** Math.max(0, attempt - 1));
  }

  private async sleep(delayMs: number) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}
