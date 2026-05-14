import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { AuthorizationModule } from './common/authorization/authorization.module';
import { KnowledgeBasesModule } from './knowledge-bases/knowledge-bases.module';
import { DocumentsModule } from './documents/documents.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware';
import { AuditModule } from './common/audit/audit.module';
import { RolesGuard } from './common/guards/roles.guard';
import { ObservabilityModule } from './common/observability/observability.module';
import { StorageModule } from './common/storage/storage.module';
import { ChatModule } from './chat/chat.module';
import { EvalsModule } from './evals/evals.module';
import { HealthModule } from './health/health.module';
import { OpsModule } from './ops/ops.module';
import { getRedisHost, getRedisPort } from './config/runtime-config';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ObservabilityModule,
    PrismaModule,
    AuthorizationModule,
    AuditModule,
    StorageModule,
    BullModule.forRoot({
      connection: {
        host: getRedisHost(),
        port: getRedisPort(),
      },
    }),
    AuthModule,
    KnowledgeBasesModule,
    DocumentsModule,
    ChatModule,
    EvalsModule,
    OpsModule,
    HealthModule,
  ],
  controllers: [],
  providers: [
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
