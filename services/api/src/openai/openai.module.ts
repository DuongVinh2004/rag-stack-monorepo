import { Module } from '@nestjs/common';
import { OpenAiClientService } from './openai-client.service';
import { OpenAiConfigService } from './openai-config.service';
import { OpenAiEmbeddingService } from './openai-embedding.service';
import { OpenAiGatewayService } from './openai-gateway.service';
import { OpenAiGroundedChatService } from './openai-grounded-chat.service';
import { OpenAiObservabilityService } from './openai-observability.service';
import { OpenAiUsageMapperService } from './openai-usage.mapper.service';

@Module({
  providers: [
    OpenAiConfigService,
    OpenAiClientService,
    OpenAiUsageMapperService,
    OpenAiObservabilityService,
    OpenAiEmbeddingService,
    OpenAiGroundedChatService,
    OpenAiGatewayService,
  ],
  exports: [OpenAiConfigService, OpenAiGatewayService],
})
export class OpenAiModule {}
