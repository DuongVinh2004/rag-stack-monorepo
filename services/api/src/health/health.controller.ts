import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthService } from './health.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @ApiOperation({ summary: 'Liveness check' })
  @Get('live')
  live() {
    return this.health.live();
  }

  @ApiOperation({ summary: 'Dependency readiness check' })
  @Get('ready')
  async ready() {
    try {
      return await this.health.ready();
    } catch (error) {
      throw new ServiceUnavailableException({
        status: 'degraded',
        service: 'api',
        message: 'Dependency readiness check failed',
        errorCode:
          error &&
          typeof error === 'object' &&
          'errorCode' in error
            ? (error as any).errorCode
            : 'DEPENDENCY_UNAVAILABLE',
        failedDependency:
          error &&
          typeof error === 'object' &&
          'failedDependency' in error
            ? (error as any).failedDependency
            : null,
        checks:
          error &&
          typeof error === 'object' &&
          'checks' in error
            ? (error as any).checks
            : {},
      });
    }
  }
}
