import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { JsonLogger } from '../observability/json-logger.service';

@Injectable()
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: JsonLogger) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const safePath = String(request.url || '').split('?')[0];
    const correlationId = request['correlationId'] || 'unknown-correlation-id';
    const requestId = request['requestId'] || correlationId;
    const userId = (request as any)['user']?.id ?? null;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let errorCode = 'INTERNAL_SERVER_ERROR';
    const exceptionName: string | null = exception instanceof Error ? exception.name : null;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      const resolvedMessage =
        typeof res === 'string'
          ? res
          : Array.isArray((res as any)?.message)
            ? (res as any).message.join(', ')
            : (res as any)?.message;
      message =
        status >= 500 ? 'Internal server error' : resolvedMessage || 'Request failed';
      errorCode =
        typeof res === 'object' && res && 'errorCode' in res
          ? String((res as any).errorCode)
          : `HTTP_${status}`;
    }

    const logPayload = {
      correlation_id: correlationId,
      error_code: errorCode,
      event: status >= 500 ? 'request_failed_internal' : 'request_failed',
      exception_name: exceptionName,
      method: request.method,
      path: safePath,
      request_id: requestId,
      status_code: status,
      user_id: userId,
    };

    if (status >= 500) {
      this.logger.error(
        logPayload,
        exception instanceof Error ? exception.stack : undefined,
        AllExceptionsFilter.name,
      );
    } else {
      this.logger.warn(
        logPayload,
        AllExceptionsFilter.name,
      );
    }

    response.status(status).json({
      success: false,
      statusCode: status,
      message,
      errorCode,
      correlationId,
      path: safePath,
      timestamp: new Date().toISOString(),
    });
  }
}
