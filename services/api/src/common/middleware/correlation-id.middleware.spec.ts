import { CorrelationIdMiddleware } from './correlation-id.middleware';

describe('CorrelationIdMiddleware', () => {
  it('reuses a valid incoming correlation id and mirrors it to request id headers', () => {
    const middleware = new CorrelationIdMiddleware();
    const req: any = {
      headers: {
        'x-correlation-id': 'corr-123',
      },
    };
    const setHeader = jest.fn();
    const res: any = { setHeader };
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(req.correlationId).toBe('corr-123');
    expect(req.requestId).toBe('corr-123');
    expect(setHeader).toHaveBeenCalledWith('x-correlation-id', 'corr-123');
    expect(setHeader).toHaveBeenCalledWith('x-request-id', 'corr-123');
    expect(next).toHaveBeenCalled();
  });

  it('generates a correlation id when the incoming header is missing or invalid', () => {
    const middleware = new CorrelationIdMiddleware();
    const req: any = {
      headers: {
        'x-correlation-id': 'bad value with spaces',
      },
    };
    const setHeader = jest.fn();
    const res: any = { setHeader };

    middleware.use(req, res, jest.fn());

    expect(req.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(req.requestId).toBe(req.correlationId);
    expect(setHeader).toHaveBeenCalledWith('x-correlation-id', req.correlationId);
    expect(setHeader).toHaveBeenCalledWith('x-request-id', req.correlationId);
  });
});
