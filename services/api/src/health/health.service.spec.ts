import { HealthService } from './health.service';

describe('HealthService', () => {
  const createService = () => {
    const prisma = {
      $queryRaw: jest.fn(),
    } as any;
    const storage = {
      checkBucket: jest.fn(),
    } as any;
    const redis = {
      ping: jest.fn(),
    } as any;

    return {
      prisma,
      storage,
      redis,
      service: new HealthService(prisma, storage, redis),
    };
  };

  it('returns liveness status', () => {
    const { service } = createService();

    expect(service.live().status).toBe('ok');
    expect(service.live().service).toBe('api');
  });

  it('returns readiness checks when dependencies are healthy', async () => {
    const { service, prisma, storage, redis } = createService();
    prisma.$queryRaw.mockResolvedValue([1]);
    redis.ping.mockResolvedValue(true);
    storage.checkBucket.mockResolvedValue(true);

    const result = await service.ready();

    expect(result.status).toBe('ok');
    expect(result.checks.database.status).toBe('ok');
    expect(result.checks.redis.status).toBe('ok');
    expect(result.checks.objectStorage.status).toBe('ok');
    expect(result.checks.database.latencyMs).toEqual(expect.any(Number));
  });

  it('surfaces dependency-specific readiness failures', async () => {
    const { service, prisma, storage, redis } = createService();
    prisma.$queryRaw.mockResolvedValue([1]);
    redis.ping.mockRejectedValue(new Error('redis down'));
    storage.checkBucket.mockResolvedValue(true);

    await expect(service.ready()).rejects.toMatchObject({
      errorCode: 'REDIS_UNAVAILABLE',
      failedDependency: 'redis',
      checks: {
        database: { status: 'ok' },
        redis: { status: 'failed' },
      },
    });
  });
});
