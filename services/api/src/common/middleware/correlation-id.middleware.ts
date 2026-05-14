import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const headerValue = Array.isArray(req.headers['x-correlation-id'])
      ? req.headers['x-correlation-id'][0]
      : req.headers['x-correlation-id'];
    const correlationId =
      typeof headerValue === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(headerValue)
        ? headerValue
        : uuidv4();
    req['correlationId'] = correlationId;
    req['requestId'] = correlationId;
    res.setHeader('x-correlation-id', correlationId);
    res.setHeader('x-request-id', String(correlationId));
    next();
  }
}
