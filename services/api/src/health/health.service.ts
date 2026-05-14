import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../common/storage/storage.service';
import { RedisHealthService } from './redis-health.service';
import { getS3Bucket } from '../config/runtime-config';

export type DependencyCheckResult = {
  status: 'ok' | 'failed';
  latencyMs: number;
};

export type ReadinessChecks = {
  database: DependencyCheckResult;
  redis: DependencyCheckResult;
  objectStorage: DependencyCheckResult;
};

type ReadinessError = Error & {
  errorCode: string;
  checks: Partial<ReadinessChecks>;
  failedDependency: keyof ReadinessChecks;
  cause?: unknown;
};

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly redis: RedisHealthService,
  ) {}

  live() {
    return {
      status: 'ok',
      service: 'api',
      timestamp: new Date().toISOString(),
    };
  }

  async ready() {
    const checks: Partial<ReadinessChecks> = {};

    checks.database = await this.runCheck(async () => {
      await this.prisma.$queryRaw(Prisma.sql`SELECT 1`);
    });
    if (checks.database.status === 'failed') {
      throw this.readinessError(
        'DATABASE_UNAVAILABLE',
        'Database readiness check failed',
        checks,
        'database',
      );
    }

    checks.redis = await this.runCheck(async () => {
      await this.redis.ping();
    });
    if (checks.redis.status === 'failed') {
      throw this.readinessError(
        'REDIS_UNAVAILABLE',
        'Redis readiness check failed',
        checks,
        'redis',
      );
    }

    checks.objectStorage = await this.runCheck(async () => {
      await this.storage.checkBucket(getS3Bucket());
    });
    if (checks.objectStorage.status === 'failed') {
      throw this.readinessError(
        'OBJECT_STORAGE_UNAVAILABLE',
        'Object storage readiness check failed',
        checks,
        'objectStorage',
      );
    }

    const result = {
      status: 'ok',
      service: 'api',
      checks: checks as ReadinessChecks,
      timestamp: new Date().toISOString(),
    };

    this.logger.log(
      {
        event: 'health_ready',
        checks: result.checks,
        service: 'api',
      },
      HealthService.name,
    );

    return result;
  }

  private async runCheck(fn: () => Promise<void>): Promise<DependencyCheckResult> {
    const startedAt = Date.now();
    try {
      await fn();
      return {
        status: 'ok',
        latencyMs: Date.now() - startedAt,
      };
    } catch {
      return {
        status: 'failed',
        latencyMs: Date.now() - startedAt,
      };
    }
  }

  private readinessError(
    errorCode: string,
    message: string,
    checks: Partial<ReadinessChecks>,
    failedDependency: keyof ReadinessChecks,
  ) {
    this.logger.warn(
      {
        event: 'health_ready_failed',
        error_code: errorCode,
        failed_dependency: failedDependency,
        checks,
        service: 'api',
      },
      HealthService.name,
    );

    const error = new Error(message) as ReadinessError;
    error.errorCode = errorCode;
    error.checks = { ...checks };
    error.failedDependency = failedDependency;
    return error;
  }
}
