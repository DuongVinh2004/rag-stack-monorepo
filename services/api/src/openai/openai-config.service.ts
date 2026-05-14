import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import {
  getOpenAiApiKey,
  getOpenAiChatModel,
  getOpenAiEmbeddingModel,
  getOpenAiGroundingMaxChunks,
  getOpenAiMaxRetries,
  getOpenAiRequestTimeoutMs,
  getOpenAiRetryBaseDelayMs,
  getOpenAiTemperature,
  isOpenAiEmbeddingsAvailable,
  isOpenAiEmbeddingsEnabled,
  isOpenAiGroundedChatAvailable,
  isOpenAiGroundedChatEnabled,
} from '../config/runtime-config';
import {
  OpenAiChatModelConfig,
  OpenAiEmbeddingModelConfig,
  OpenAiRetryPolicy,
} from './openai.types';

@Injectable()
export class OpenAiConfigService {
  private readonly apiKey = getOpenAiApiKey();
  private readonly chatModel = getOpenAiChatModel();
  private readonly embeddingModel = getOpenAiEmbeddingModel();
  private readonly requestTimeoutMs = getOpenAiRequestTimeoutMs();
  private readonly maxRetries = getOpenAiMaxRetries();
  private readonly retryBaseDelayMs = getOpenAiRetryBaseDelayMs();
  private readonly groundedChatMaxChunks = getOpenAiGroundingMaxChunks();
  private readonly temperature = getOpenAiTemperature();
  private readonly embeddingsFeatureEnabled = isOpenAiEmbeddingsEnabled();
  private readonly groundedChatFeatureEnabled = isOpenAiGroundedChatEnabled();

  get hasApiKey() {
    return Boolean(this.apiKey);
  }

  get configuredChatModel() {
    return this.chatModel;
  }

  get configuredEmbeddingModel() {
    return this.embeddingModel;
  }

  get timeoutMs() {
    return this.requestTimeoutMs;
  }

  get retries() {
    return this.maxRetries;
  }

  get retryPolicy(): OpenAiRetryPolicy {
    return {
      maxRetries: this.maxRetries,
      baseDelayMs: this.retryBaseDelayMs,
    };
  }

  get maxGroundingChunks() {
    return this.groundedChatMaxChunks;
  }

  get chatTemperature() {
    return this.temperature;
  }

  get queryEmbeddingsEnabled() {
    return this.embeddingsFeatureEnabled;
  }

  get groundedChatEnabled() {
    return this.groundedChatFeatureEnabled;
  }

  get queryEmbeddingsAvailable() {
    return isOpenAiEmbeddingsAvailable();
  }

  get groundedChatAvailable() {
    return isOpenAiGroundedChatAvailable();
  }

  get embeddingModelConfig(): OpenAiEmbeddingModelConfig {
    return {
      provider: 'openai',
      operation: 'embedding',
      model: this.configuredEmbeddingModel,
      timeoutMs: this.timeoutMs,
      retryPolicy: this.retryPolicy,
      featureEnabled: this.queryEmbeddingsEnabled,
      available: this.queryEmbeddingsAvailable,
    };
  }

  get chatModelConfig(): OpenAiChatModelConfig {
    return {
      provider: 'openai',
      operation: 'chat',
      model: this.configuredChatModel,
      timeoutMs: this.timeoutMs,
      retryPolicy: this.retryPolicy,
      featureEnabled: this.groundedChatEnabled,
      available: this.groundedChatAvailable,
      temperature: this.chatTemperature,
      maxGroundingChunks: this.maxGroundingChunks,
    };
  }

  createClient() {
    if (!this.apiKey) {
      return null;
    }

    return new OpenAI({
      apiKey: this.apiKey,
      baseURL: process.env.OPENAI_BASE_URL,
      maxRetries: 0,
      timeout: this.requestTimeoutMs,
    });
  }

  describe() {
    return {
      hasApiKey: this.hasApiKey,
      groundedChatAvailable: this.groundedChatAvailable,
      groundedChatEnabled: this.groundedChatEnabled,
      groundedChatMaxChunks: this.maxGroundingChunks,
      chatModel: this.configuredChatModel,
      embeddingModel: this.configuredEmbeddingModel,
      embeddingsAvailable: this.queryEmbeddingsAvailable,
      embeddingsEnabled: this.queryEmbeddingsEnabled,
      retryPolicy: this.retryPolicy,
      timeoutMs: this.timeoutMs,
      temperature: this.chatTemperature,
    };
  }
}
