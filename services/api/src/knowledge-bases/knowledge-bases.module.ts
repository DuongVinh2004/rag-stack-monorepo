import { Module } from '@nestjs/common';
import { KnowledgeBasesService } from './knowledge-bases.service';
import { KnowledgeBasesController } from './knowledge-bases.controller';

@Module({
  controllers: [KnowledgeBasesController],
  providers: [KnowledgeBasesService],
  exports: [KnowledgeBasesService],
})
export class KnowledgeBasesModule {}
