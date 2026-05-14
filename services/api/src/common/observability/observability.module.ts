import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { JsonLogger } from './json-logger.service';
import { MetricsService } from './metrics.service';
import { RequestLoggingInterceptor } from './request-logging.interceptor';
import { TracingService } from './tracing.service';

@Global()
@Module({
  providers: [
    JsonLogger,
    MetricsService,
    TracingService,
    {
      provide: APP_INTERCEPTOR,
      useClass: RequestLoggingInterceptor,
    },
  ],
  exports: [JsonLogger, MetricsService, TracingService],
})
export class ObservabilityModule {}
