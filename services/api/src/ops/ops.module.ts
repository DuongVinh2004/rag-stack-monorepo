import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AuditModule } from '../common/audit/audit.module';
import { INGEST_QUEUE_NAME } from '../documents/documents.constants';
import { OpsController } from './ops.controller';
import { OpsService } from './ops.service';

@Module({
  imports: [AuditModule, BullModule.registerQueue({ name: INGEST_QUEUE_NAME })],
  controllers: [OpsController],
  providers: [OpsService],
})
export class OpsModule {}
