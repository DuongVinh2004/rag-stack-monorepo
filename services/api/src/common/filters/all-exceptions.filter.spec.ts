import { ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { JsonLogger } from '../observability/json-logger.service';

describe('AllExceptionsFilter', () => {
  it('returns a safe JSON body with correlationId and errorCode for HttpException', () => {
    const logger = {
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as JsonLogger;

    const filter = new AllExceptionsFilter(logger);
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const response = { status };
    const request = {
      method: 'GET',
      url: '/api/v1/kb?x=1',
      correlationId: 'corr-test',
    };

    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => request,
      }),
    } as unknown as ArgumentsHost;

    filter.catch(
      new HttpException(
        { message: 'Forbidden', errorCode: 'KB_ACCESS_DENIED' },
        HttpStatus.FORBIDDEN,
      ),
      host,
    );

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        errorCode: 'KB_ACCESS_DENIED',
        correlationId: 'corr-test',
        path: '/api/v1/kb',
      }),
    );
  });
});
