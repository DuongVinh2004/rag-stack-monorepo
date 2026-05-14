import { ConsoleLogger, Injectable, LogLevel } from '@nestjs/common';

const REDACTED = '[REDACTED]';
const SENSITIVE_KEY_PATTERN =
  /(authorization|password|passwordhash|secret|token|api[-_]?key|s3key|objectkey|prompt|instructions|input)/i;

@Injectable()
export class JsonLogger extends ConsoleLogger {
  override log(message: any, context?: string): void {
    this.writeStructured('log', message, context);
  }

  override error(message: any, trace?: string, context?: string): void {
    this.writeStructured('error', message, context, trace);
  }

  override warn(message: any, context?: string): void {
    this.writeStructured('warn', message, context);
  }

  override debug(message: any, context?: string): void {
    this.writeStructured('debug', message, context);
  }

  override verbose(message: any, context?: string): void {
    this.writeStructured('verbose', message, context);
  }

  override fatal(message: any, trace?: string, context?: string): void {
    this.writeStructured('fatal' as LogLevel, message, context, trace);
  }

  private writeStructured(level: LogLevel | 'fatal', message: any, context?: string, trace?: string) {
    const parsedMessage = this.parseMessage(message);
    const payload: Record<string, unknown> =
      parsedMessage instanceof Error
        ? {
            errorName: parsedMessage.name,
            message: parsedMessage.message,
            stack: parsedMessage.stack,
          }
        : typeof parsedMessage === 'object' && parsedMessage !== null
          ? (this.redactValue(parsedMessage) as Record<string, unknown>)
          : { message: String(parsedMessage) };

    const record = {
      timestamp: new Date().toISOString(),
      level,
      context: context ?? this.context ?? 'Application',
      pid: process.pid,
      ...payload,
      ...(trace ? { trace } : {}),
    };

    const line = JSON.stringify(record);
    if (level === 'error' || level === 'fatal') {
      process.stderr.write(`${line}\n`);
      return;
    }
    process.stdout.write(`${line}\n`);
  }

  private parseMessage(message: unknown) {
    if (typeof message !== 'string') {
      return message;
    }

    const trimmed = message.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
      return message;
    }

    try {
      return JSON.parse(trimmed);
    } catch {
      return message;
    }
  }

  private redactValue(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.redactValue(item));
    }

    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, entryValue]) => [
          this.toSnakeCase(key),
          SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : this.redactValue(entryValue),
        ]),
      );
    }

    return value;
  }

  private toSnakeCase(value: string) {
    return value
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .replace(/[-\s]+/g, '_')
      .toLowerCase();
  }
}
