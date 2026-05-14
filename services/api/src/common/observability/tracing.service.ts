import { Injectable } from '@nestjs/common';

type SpanAttributes = Record<string, string | number | boolean | null | undefined>;

export type TraceSpan = {
  setAttribute(name: string, value: string | number | boolean | null | undefined): void;
  recordException(error: unknown): void;
  end(extra?: SpanAttributes): void;
};

@Injectable()
export class TracingService {
  startSpan(_name: string, _attributes?: SpanAttributes): TraceSpan {
    const attributes: SpanAttributes = {};

    return {
      setAttribute(name, value) {
        attributes[name] = value;
      },
      recordException(error) {
        attributes.error = error instanceof Error ? error.message : 'unknown_error';
      },
      end(extra) {
        if (!extra) {
          return;
        }
        Object.assign(attributes, extra);
      },
    };
  }
}
