import { Injectable } from '@nestjs/common';
import IORedis from 'ioredis';
import { getRedisHost, getRedisPort } from '../config/runtime-config';

@Injectable()
export class RedisHealthService {
  async ping() {
    const redis = new IORedis({
      host: getRedisHost(),
      port: getRedisPort(),
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });

    try {
      await redis.connect();
      await redis.ping();
      return true;
    } finally {
      redis.disconnect();
    }
  }
}
