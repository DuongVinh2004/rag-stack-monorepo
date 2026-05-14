import {
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { KbRole, SystemRole } from "@prisma/client";
import { AuthorizationService } from "./authorization.service";

describe("AuthorizationService", () => {
  const createService = () => {
    const prisma = {
      knowledgeBase: {
        findFirst: jest.fn(),
      },
      document: {
        findFirst: jest.fn(),
      },
    } as any;

    return {
      prisma,
      service: new AuthorizationService(prisma),
    };
  };

  it("lets admins override KB membership checks explicitly", async () => {
    const { service, prisma } = createService();
    prisma.knowledgeBase.findFirst.mockResolvedValue({
      id: "kb-1",
      members: [],
    });

    const result = await service.assertKnowledgeBaseRole(
      {
        id: "admin-1",
        UserRole: [{ role: { name: SystemRole.SUPER_ADMIN } }],
      },
      "kb-1",
      [KbRole.OWNER],
    );

    expect(result.membershipRole).toBeNull();
  });

  it("rejects viewers from editor-only KB actions with forbidden", async () => {
    const { service, prisma } = createService();
    prisma.knowledgeBase.findFirst.mockResolvedValue({
      id: "kb-1",
      members: [{ userId: "user-1", role: KbRole.VIEWER }],
    });

    await expect(
      service.assertKnowledgeBaseRole(
        { id: "user-1" },
        "kb-1",
        [KbRole.OWNER, KbRole.EDITOR],
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("allows editors in their own KB and hides other KBs with not found", async () => {
    const { service, prisma } = createService();
    prisma.knowledgeBase.findFirst
      .mockResolvedValueOnce({
        id: "kb-own",
        members: [{ userId: "user-1", role: KbRole.EDITOR }],
      })
      .mockResolvedValueOnce(null);

    await expect(
      service.assertKnowledgeBaseRole(
        { id: "user-1" },
        "kb-own",
        [KbRole.OWNER, KbRole.EDITOR],
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        membershipRole: KbRole.EDITOR,
      }),
    );

    await expect(
      service.assertKnowledgeBaseRole(
        { id: "user-1" },
        "kb-other",
        [KbRole.OWNER, KbRole.EDITOR],
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("rejects normal users from operator-only domains", () => {
    const { service } = createService();

    expect(() => service.assertOpsAccess({ id: "user-1" })).toThrow(
      ForbiddenException,
    );
  });
});
