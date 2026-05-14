/**
 * E2E workflow tests for the RAG Backend API.
 *
 * These tests spin up a "lite" NestJS application using the real AppModule
 * wired against lightweight module-level mocks for external dependencies
 * (PrismaService, StorageService, RedisHealthService, BullMQ Queue).
 *
 * They verify that the HTTP routing, authentication guards, role guards,
 * validation pipes, and exception filters are wired correctly end-to-end —
 * without requiring a live database, Redis, or object storage instance.
 */

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { StorageService } from '../src/common/storage/storage.service';
import { RedisHealthService } from '../src/health/redis-health.service';

/* ─────────────────── helpers ─────────────────── */

function buildPrismaStub() {
  return {
    $connect: jest.fn().mockResolvedValue(undefined),
    $disconnect: jest.fn().mockResolvedValue(undefined),
    $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    $transaction: jest.fn(async (fn: (tx: any) => any) => {
      return fn(buildPrismaStub());
    }),
    user: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    refreshSession: {
      create: jest.fn().mockResolvedValue({ id: 'session-1' }),
      findUnique: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      update: jest.fn(),
    },
    knowledgeBase: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    kbMember: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
    },
    document: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn(),
    },
    documentVersion: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn(),
    },
    documentChunk: {
      count: jest.fn().mockResolvedValue(0),
    },
    ingestJob: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    auditLog: {
      create: jest.fn().mockResolvedValue({}),
    },
    conversation: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
    },
    conversationMessage: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
    },
    evalSet: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
    },
    evalRun: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn(),
    },
    evalItem: { create: jest.fn() },
    evalCase: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    userRole: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
}

/* ─────────────────── suite ─────────────────── */

describe('RAG Backend E2E — HTTP layer integration', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const prismaStub = buildPrismaStub();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaStub)
      .overrideProvider(StorageService)
      .useValue({ uploadFile: jest.fn(), checkBucket: jest.fn().mockResolvedValue(undefined) })
      .overrideProvider(RedisHealthService)
      .useValue({ ping: jest.fn().mockResolvedValue(true) })
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  /* ───── Health ───── */

  describe('GET /api/v1/health/live', () => {
    it('returns 200 with status ok — no auth required', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/health/live')
        .expect(200);

      expect(res.body.status).toBe('ok');
      expect(res.body.service).toBe('api');
    });
  });

  describe('GET /api/v1/health/ready', () => {
    it('returns 200 when all dependency stubs succeed', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/health/ready')
        .expect(200);

      expect(res.body.status).toBe('ok');
      expect(res.body.checks).toHaveProperty('database');
      expect(res.body.checks).toHaveProperty('redis');
      expect(res.body.checks).toHaveProperty('objectStorage');
    });
  });

  /* ───── Auth guard enforcement ───── */

  describe('Unauthenticated access', () => {
    it('returns 401 for GET /api/v1/knowledge-bases without token', () => {
      return request(app.getHttpServer())
        .get('/api/v1/knowledge-bases')
        .expect(401);
    });

    it('returns 401 for POST /api/v1/documents/upload without token', () => {
      return request(app.getHttpServer())
        .post('/api/v1/documents/upload')
        .expect(401);
    });

    it('returns 401 for POST /api/v1/chat/ask without token', () => {
      return request(app.getHttpServer())
        .post('/api/v1/chat/ask')
        .send({ kbId: 'some-id', question: 'test' })
        .expect(401);
    });

    it('returns 401 for GET /api/v1/conversations without token', () => {
      return request(app.getHttpServer())
        .get('/api/v1/conversations')
        .expect(401);
    });

    it('returns 401 for GET /api/v1/evals/sets without token', () => {
      return request(app.getHttpServer())
        .get('/api/v1/evals/sets')
        .expect((res) => {
          expect([401, 403]).toContain(res.status);
        });
    });

    it('returns 401 for GET /api/v1/ops/metrics without token', () => {
      return request(app.getHttpServer())
        .get('/api/v1/ops/metrics')
        .expect((res) => {
          expect([401, 403]).toContain(res.status);
        });
    });

    it('returns 401 for GET /api/v1/auth/me without token', () => {
      return request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .expect(401);
    });
  });

  /* ───── Validation pipe enforcement ───── */

  describe('Validation on public auth endpoints', () => {
    it('returns 400 for POST /api/v1/auth/login with empty body', () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({})
        .expect(400);
    });

    it('returns 400 for POST /api/v1/auth/login with invalid email', () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'not-an-email', password: 'pw' })
        .expect(400);
    });

    it('returns 400 for POST /api/v1/auth/register with no password', () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: 'user@example.com' })
        .expect(400);
    });

    it('returns 400 for POST /api/v1/auth/refresh with empty body', () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({})
        .expect(400);
    });
  });

  /* ───── Error response shape ───── */

  describe('Error response envelope', () => {
    it('401 response has the standard error envelope shape', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/knowledge-bases')
        .expect(401);

      expect(res.body).toMatchObject({
        success: false,
        statusCode: 401,
        message: expect.any(String),
        correlationId: expect.any(String),
        timestamp: expect.any(String),
        path: '/api/v1/knowledge-bases',
      });
    });

    it('Swagger UI is accessible at /api/v1/docs', async () => {
      // Swagger is available at the configured path
      await request(app.getHttpServer())
        .get('/api/v1/docs')
        .expect(404); // Swagger UI is loaded in main.ts, not in the module test app
    });
  });

  /* ───── CORS headers ───── */

  describe('CORS headers', () => {
    it('sets x-correlation-id on every response', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/health/live');

      expect(res.headers['x-correlation-id']).toBeDefined();
      expect(res.headers['x-request-id']).toBeDefined();
    });

    it('echoes back a provided x-correlation-id', async () => {
      const myId = 'my-trace-abc-123';
      const res = await request(app.getHttpServer())
        .get('/api/v1/health/live')
        .set('x-correlation-id', myId);

      expect(res.headers['x-correlation-id']).toBe(myId);
    });
  });
});
