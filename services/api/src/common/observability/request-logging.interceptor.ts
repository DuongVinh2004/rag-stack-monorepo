import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { MetricsService } from './metrics.service';
import { JsonLogger } from './json-logger.service';

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  constructor(
    private readonly logger: JsonLogger,
    private readonly metrics: MetricsService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const http = context.switchToHttp();
    const request = http.getRequest();
    const response = http.getResponse();
    const startedAt = Date.now();

    return next.handle().pipe(
      finalize(() => {
        const durationMs = Date.now() - startedAt;
        const correlationId = request?.correlationId ?? request?.headers?.['x-correlation-id'] ?? null;
        const requestId = request?.requestId ?? correlationId;
        const userId = request?.user?.id ?? null;
        const path =
          request?.route?.path ??
          String(request?.originalUrl ?? request?.url ?? '').split('?')[0];
        const method = request?.method ?? 'UNKNOWN';
        const statusCode = response?.statusCode ?? 500;

        this.metrics.increment('http_requests_total', 1, {
          method,
          route: path,
          status_code: statusCode,
        });
        this.metrics.recordDuration('http_request_duration_ms', durationMs, {
          method,
          route: path,
        });

        this.logger.log(
          {
            correlation_id: correlationId,
            duration_ms: durationMs,
            event: 'request_completed',
            method,
            path,
            request_id: requestId,
            status_code: statusCode,
            user_id: userId,
          },
          RequestLoggingInterceptor.name,
        );
      }),
    );
  }
}
