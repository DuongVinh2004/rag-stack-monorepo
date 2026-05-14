import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { DocumentsService } from './documents.service';
import { DocumentsController } from './documents.controller';
import { KnowledgeBasesModule } from '../knowledge-bases/knowledge-bases.module';
import { INGEST_QUEUE_NAME } from './documents.constants';

@Module({
  imports: [
    KnowledgeBasesModule,
    BullModule.registerQueue({
      name: INGEST_QUEUE_NAME,
    }),
  ],
  providers: [DocumentsService],
  controllers: [DocumentsController],
})
export class DocumentsModule {}
