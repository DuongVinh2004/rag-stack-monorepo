import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { JwtModule } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import * as request from "supertest";
import { AuthController } from "../src/auth/auth.controller";
import { AuthService } from "../src/auth/auth.service";
import { JwtAuthGuard } from "../src/auth/jwt-auth.guard";
import { PrismaService } from "../src/prisma/prisma.service";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const USER_EMAIL = "demo-admin@example.com";
const USER_PASSWORD = "DemoPass1234";
const JWT_SECRET = "test-jwt-secret-32-characters-minimum";

class AllowAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    request.user = { id: USER_ID };
    return true;
  }
}

class FakePrismaService {
  refreshSessions: Array<{
    id: string;
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    revokedAt: Date | null;
    createdAt: Date;
    lastUsedAt: Date | null;
  }> = [];

  users: Array<{
    id: string;
    email: string;
    passwordHash: string;
    status: "ACTIVE" | "DISABLED";
  }> = [];

  async seedUser() {
    this.users = [
      {
        id: USER_ID,
        email: USER_EMAIL,
        passwordHash: await bcrypt.hash(USER_PASSWORD, 12),
        status: "ACTIVE",
      },
    ];
    this.refreshSessions = [];
  }

  user = {
    findUnique: jest.fn(async ({ where }: any) => {
      if (where.email) {
        return this.users.find((user) => user.email === where.email) ?? null;
      }
      if (where.id) {
        return this.users.find((user) => user.id === where.id) ?? null;
      }
      return null;
    }),
    create: jest.fn(async ({ data }: any) => {
      const user = {
        id: USER_ID,
        email: data.email,
        passwordHash: data.passwordHash,
        status: data.status ?? "ACTIVE",
      };
      this.users.push(user);
      return user;
    }),
  };

  refreshSession = {
    create: jest.fn(async ({ data }: any) => {
      const session = {
        id: data.id,
        userId: data.userId,
        tokenHash: data.tokenHash,
        expiresAt: data.expiresAt,
        revokedAt: data.revokedAt ?? null,
        createdAt: new Date(),
        lastUsedAt: data.lastUsedAt ?? null,
      };
      this.refreshSessions.push(session);
      return session;
    }),
    findUnique: jest.fn(async ({ where, include }: any) => {
      const session =
        this.refreshSessions.find((item) => item.id === where.id) ?? null;
      if (!session) {
        return null;
      }
      return {
        ...session,
        ...(include?.user
          ? {
              user: this.users.find((user) => user.id === session.userId) ?? null,
            }
          : {}),
      };
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const session = this.refreshSessions.find((item) => item.id === where.id);
      if (!session) {
        throw new Error("refresh session not found");
      }
      Object.assign(session, data);
      return { ...session };
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      let count = 0;
      for (const session of this.refreshSessions) {
        if (session.userId !== where.userId) {
          continue;
        }
        if (where.revokedAt === null && session.revokedAt !== null) {
          continue;
        }
        Object.assign(session, data);
        count += 1;
      }
      return { count };
    }),
  };

  $transaction = jest.fn(async (callback: any) =>
    callback({
      refreshSession: {
        create: this.refreshSession.create,
        update: this.refreshSession.update,
      },
    }),
  );
}

describe("Auth API", () => {
  let app: INestApplication;
  let prisma: FakePrismaService;

  beforeAll(async () => {
    prisma = new FakePrismaService();
    await prisma.seedUser();

    const moduleRef = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: JWT_SECRET,
          signOptions: {
            audience: "rag-backend-clients",
            expiresIn: "60m",
            issuer: "rag-backend-api",
          },
          verifyOptions: {
            audience: "rag-backend-clients",
            issuer: "rag-backend-api",
          },
        }),
      ],
      controllers: [AuthController],
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(AllowAuthGuard)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.seedUser();
    prisma.user.findUnique.mockClear();
    prisma.refreshSession.create.mockClear();
    prisma.refreshSession.findUnique.mockClear();
    prisma.refreshSession.update.mockClear();
    prisma.refreshSession.updateMany.mockClear();
  });

  it("logs in, rotates refresh tokens, and revokes sessions on logout", async () => {
    const loginResponse = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({
        email: USER_EMAIL,
        password: USER_PASSWORD,
      })
      .expect(200);

    expect(loginResponse.body.access_token).toEqual(expect.any(String));
    expect(loginResponse.body.refresh_token).toEqual(expect.any(String));
    expect(loginResponse.body.user).toMatchObject({
      email: USER_EMAIL,
      id: USER_ID,
      status: "ACTIVE",
    });
    expect(loginResponse.body.user.passwordHash).toBeUndefined();

    const refreshResponse = await request(app.getHttpServer())
      .post("/api/v1/auth/refresh")
      .send({
        refreshToken: loginResponse.body.refresh_token,
      })
      .expect(200);

    expect(refreshResponse.body.access_token).toEqual(expect.any(String));
    expect(refreshResponse.body.refresh_token).toEqual(expect.any(String));
    expect(refreshResponse.body.refresh_token).not.toBe(
      loginResponse.body.refresh_token,
    );
    expect(prisma.refreshSession.update).toHaveBeenCalledTimes(1);

    const logoutResponse = await request(app.getHttpServer())
      .post("/api/v1/auth/logout")
      .expect(200);

    expect(logoutResponse.body.message).toBe("Logged out successfully");
    expect(prisma.refreshSession.updateMany).toHaveBeenCalledWith({
      where: {
        userId: USER_ID,
        revokedAt: null,
      },
      data: expect.objectContaining({
        revokedAt: expect.any(Date),
        lastUsedAt: expect.any(Date),
      }),
    });
  });

  it("returns the authenticated profile from /auth/me", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/v1/auth/me")
      .expect(200);

    expect(response.body).toMatchObject({
      email: USER_EMAIL,
      id: USER_ID,
      status: "ACTIVE",
    });
    expect(response.body.passwordHash).toBeUndefined();
  });
});
