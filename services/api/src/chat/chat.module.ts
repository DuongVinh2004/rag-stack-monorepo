import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { RetrievalService } from './retrieval.service';
import { QueryNormalizerService } from './query-normalizer.service';
import { HybridScorerService } from './hybrid-scorer.service';
import { CitationAssemblerService } from './citation-assembler.service';
import { LocalGroundedAnswerService } from './local-grounded-answer.service';
import { PromptBuilderService } from './prompt-builder.service';
import { ConversationPersistenceService } from './conversation-persistence.service';
import { RetrievalQueryRepository } from './retrieval-query.repository';
import { KnowledgeBasesModule } from '../knowledge-bases/knowledge-bases.module';
import { OpenAiModule } from '../openai/openai.module';

@Module({
  imports: [KnowledgeBasesModule, OpenAiModule],
  controllers: [ChatController],
  providers: [
    ChatService,
    RetrievalService,
    QueryNormalizerService,
    HybridScorerService,
    CitationAssemblerService,
    LocalGroundedAnswerService,
    PromptBuilderService,
    ConversationPersistenceService,
    RetrievalQueryRepository,
  ],
  exports: [
    RetrievalService,
    QueryNormalizerService,
    HybridScorerService,
    CitationAssemblerService,
    PromptBuilderService,
    OpenAiModule,
  ],
})
export class ChatModule {}
