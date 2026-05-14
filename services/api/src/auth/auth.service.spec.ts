import { UnauthorizedException } from "@nestjs/common";
import { AuthService } from "./auth.service";

jest.mock("bcryptjs", () => ({
  compare: jest.fn(async (plain: string, hash: string) => hash === `hashed:${plain}`),
  hash: jest.fn(async (plain: string) => `hashed:${plain}`),
}));

describe("AuthService", () => {
  const createService = () => {
    const prisma = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      refreshSession: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      $transaction: jest.fn(
        async (
          callback: (tx: {
            refreshSession: {
              create: jest.Mock;
              update: jest.Mock;
            };
          }) => Promise<unknown>,
        ) =>
          callback({
            refreshSession: {
              create: prisma.refreshSession.create,
              update: prisma.refreshSession.update,
            },
          }),
      ),
    } as any;
    const jwtService = {
      sign: jest
        .fn()
        .mockImplementation(
          (payload: { tokenType?: string; sessionId?: string }) =>
            payload.tokenType === "refresh"
              ? `refresh-token-${payload.sessionId}`
              : "access-token",
        ),
      verifyAsync: jest.fn(),
      decode: jest.fn(() => ({
        exp: Math.floor(new Date("2030-05-04T10:00:00Z").getTime() / 1000),
      })),
    } as any;

    return {
      prisma,
      jwtService,
      service: new AuthService(prisma, jwtService),
    };
  };

  it("normalizes email addresses during registration", async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockImplementation(async ({ data }: any) => ({
      id: "user-1",
      email: data.email,
      passwordHash: data.passwordHash,
      status: "ACTIVE",
    }));

    const result = await service.register({
      email: "  USER@Example.com ",
      password: "Password123",
    });

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: "user@example.com" },
    });
    expect(result.email).toBe("user@example.com");
  });

  it("blocks disabled users from authenticating", async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      passwordHash: "hashed:Password123",
      status: "DISABLED",
    });

    await expect(
      service.login({
        email: "user@example.com",
        password: "Password123",
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("issues a refresh session on login and rotates it on refresh", async () => {
    const { service, prisma, jwtService } = createService();
    prisma.user.findUnique.mockResolvedValueOnce({
      id: "user-1",
      email: "user@example.com",
      passwordHash: "hashed:Password123",
      status: "ACTIVE",
    });

    const loginResult = await service.login({
      email: "user@example.com",
      password: "Password123",
    });

    expect(loginResult.access_token).toBe("access-token");
    expect(loginResult.refresh_token).toContain("refresh-token-");
    expect(prisma.refreshSession.create).toHaveBeenCalledTimes(1);

    const createdSessionId =
      prisma.refreshSession.create.mock.calls[0][0].data.id;
    prisma.refreshSession.findUnique.mockResolvedValue({
      id: createdSessionId,
      userId: "user-1",
      tokenHash:
        prisma.refreshSession.create.mock.calls[0][0].data.tokenHash,
      expiresAt: new Date("2030-05-04T10:00:00Z"),
      revokedAt: null,
      user: {
        id: "user-1",
        email: "user@example.com",
        passwordHash: "hashed:Password123",
        status: "ACTIVE",
      },
    });
    jwtService.verifyAsync.mockResolvedValue({
      sub: "user-1",
      tokenType: "refresh",
      sessionId: createdSessionId,
    });

    const refreshed = await service.refresh({
      refreshToken: loginResult.refresh_token,
    });

    expect(prisma.refreshSession.update).toHaveBeenCalledWith({
      where: { id: createdSessionId },
      data: expect.objectContaining({
        revokedAt: expect.any(Date),
        lastUsedAt: expect.any(Date),
      }),
    });
    expect(refreshed.access_token).toBe("access-token");
    expect(refreshed.refresh_token).toContain("refresh-token-");
  });

  it("revokes active refresh sessions on logout", async () => {
    const { service, prisma } = createService();
    prisma.refreshSession.updateMany.mockResolvedValue({ count: 2 });

    await service.logout("user-1");

    expect(prisma.refreshSession.updateMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        revokedAt: null,
      },
      data: expect.objectContaining({
        revokedAt: expect.any(Date),
        lastUsedAt: expect.any(Date),
      }),
    });
  });
});
