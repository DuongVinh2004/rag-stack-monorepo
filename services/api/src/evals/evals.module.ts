import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { AuditModule } from '../common/audit/audit.module';
import { EvalsController } from './evals.controller';
import { EvalScoringService } from './eval-scoring.service';
import { EvalsService } from './evals.service';

@Module({
  imports: [ChatModule, AuditModule],
  controllers: [EvalsController],
  providers: [EvalsService, EvalScoringService],
})
export class EvalsModule {}
