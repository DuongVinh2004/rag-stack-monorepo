import { Injectable } from '@nestjs/common';
import { GroundedPrompt } from '../chat/chat.types';
import { OpenAiConfigService } from './openai-config.service';
import { OpenAiEmbeddingService } from './openai-embedding.service';
import { OpenAiGroundedChatService } from './openai-grounded-chat.service';
import {
  GroundedAnswerResult,
  OpenAiRequestContext,
  QueryEmbeddingResult,
} from './openai.types';

@Injectable()
export class OpenAiGatewayService {
  constructor(
    private readonly config: OpenAiConfigService,
    private readonly embeddings: OpenAiEmbeddingService,
    private readonly groundedChat: OpenAiGroundedChatService,
  ) {}

  get isConfigured() {
    return this.config.groundedChatAvailable;
  }

  get configuredChatModel() {
    return this.config.chatModelConfig.model;
  }

  get configuredEmbeddingModel() {
    return this.config.embeddingModelConfig.model;
  }

  get maxGroundingChunks() {
    return this.config.chatModelConfig.maxGroundingChunks;
  }

  get embeddingsEnabled() {
    return this.config.embeddingModelConfig.available;
  }

  get featureSummary() {
    return this.config.describe();
  }

  createQueryEmbedding(
    query: string,
    context: Omit<OpenAiRequestContext, 'batchSize'>,
  ): Promise<QueryEmbeddingResult> {
    return this.embeddings.createQueryEmbedding(query, context);
  }

  createGroundedAnswer(
    prompt: GroundedPrompt,
    context: OpenAiRequestContext,
  ): Promise<GroundedAnswerResult> {
    return this.groundedChat.createGroundedAnswer(prompt, context);
  }
}
