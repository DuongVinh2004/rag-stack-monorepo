import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { KbRole, Prisma, SystemRole } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AuthenticatedUser } from "./authorization.types";

const KB_ROLE_PRIORITY: Record<KbRole, number> = {
  [KbRole.VIEWER]: 1,
  [KbRole.EDITOR]: 2,
  [KbRole.OWNER]: 3,
};

@Injectable()
export class AuthorizationService {
  constructor(private readonly prisma: PrismaService) {}

  listSystemRoles(user: AuthenticatedUser | null | undefined) {
    return (user?.UserRole ?? [])
      .map((userRole) => userRole.role?.name)
      .filter((role): role is SystemRole => typeof role === "string");
  }

  hasAnySystemRole(
    user: AuthenticatedUser | null | undefined,
    allowedRoles: SystemRole[],
  ) {
    if (!allowedRoles.length) {
      return true;
    }

    const roleSet = new Set(this.listSystemRoles(user));
    return allowedRoles.some((role) => roleSet.has(role));
  }

  isAdmin(user: AuthenticatedUser | null | undefined) {
    return this.hasAnySystemRole(user, [SystemRole.SUPER_ADMIN]);
  }

  isOperator(user: AuthenticatedUser | null | undefined) {
    return this.hasAnySystemRole(user, [
      SystemRole.SUPER_ADMIN,
      SystemRole.OPERATOR,
    ]);
  }

  assertGlobalRole(
    user: AuthenticatedUser | null | undefined,
    allowedRoles: SystemRole[],
    message = "Forbidden",
  ) {
    if (!this.hasAnySystemRole(user, allowedRoles)) {
      throw new ForbiddenException(message);
    }
  }

  assertOpsAccess(user: AuthenticatedUser | null | undefined) {
    this.assertGlobalRole(
      user,
      [SystemRole.SUPER_ADMIN, SystemRole.OPERATOR],
      "Operator access required",
    );
  }

  buildKnowledgeBaseReadWhere(
    user: AuthenticatedUser,
    kbId?: string,
  ): Prisma.KnowledgeBaseWhereInput {
    if (this.isAdmin(user)) {
      return {
        ...(kbId ? { id: kbId } : {}),
        status: "ACTIVE",
      };
    }

    return {
      ...(kbId ? { id: kbId } : {}),
      status: "ACTIVE",
      members: {
        some: {
          userId: user.id,
        },
      },
    };
  }

  buildDocumentReadWhere(
    user: AuthenticatedUser,
    documentId?: string,
  ): Prisma.DocumentWhereInput {
    if (this.isAdmin(user)) {
      return {
        ...(documentId ? { id: documentId } : {}),
        kb: { status: "ACTIVE" },
      };
    }

    return {
      ...(documentId ? { id: documentId } : {}),
      kb: {
        status: "ACTIVE",
        members: {
          some: {
            userId: user.id,
          },
        },
      },
    };
  }

  buildConversationReadWhere(
    user: AuthenticatedUser,
    conversationId?: string,
  ): Prisma.ConversationWhereInput {
    if (this.isAdmin(user)) {
      return {
        ...(conversationId ? { id: conversationId } : {}),
        kb: { status: "ACTIVE" },
      };
    }

    return {
      ...(conversationId ? { id: conversationId } : {}),
      userId: user.id,
      kb: {
        status: "ACTIVE",
        members: {
          some: {
            userId: user.id,
          },
        },
      },
    };
  }

  async assertKnowledgeBaseRead<
    TInclude extends Prisma.KnowledgeBaseInclude | undefined,
  >(user: AuthenticatedUser, kbId: string, include?: TInclude) {
    const kb = (await this.prisma.knowledgeBase.findFirst({
      where: this.buildKnowledgeBaseReadWhere(user, kbId),
      include,
    })) as Prisma.KnowledgeBaseGetPayload<{ include: TInclude }> | null;

    if (!kb) {
      throw new NotFoundException("Knowledge base not found");
    }

    return kb;
  }

  async assertKnowledgeBaseRole<
    TInclude extends Prisma.KnowledgeBaseInclude | undefined,
  >(
    user: AuthenticatedUser,
    kbId: string,
    allowedRoles: KbRole[],
    include?: TInclude,
  ) {
    const kb = (await this.prisma.knowledgeBase.findFirst({
      where: this.buildKnowledgeBaseReadWhere(user, kbId),
      include: {
        ...(include ?? {}),
        members: {
          where: { userId: user.id },
          select: {
            role: true,
            userId: true,
          },
          take: 1,
        },
      },
    })) as
      | (Prisma.KnowledgeBaseGetPayload<{
          include: TInclude & {
            members: {
              where: { userId: string };
              select: { role: true; userId: true };
              take: 1;
            };
          };
        }> & { members: Array<{ role: KbRole; userId: string }> })
      | null;

    if (!kb) {
      throw new NotFoundException("Knowledge base not found");
    }

    if (this.isAdmin(user)) {
      return {
        kb,
        membershipRole: null,
      };
    }

    const membershipRole = kb.members[0]?.role ?? null;
    if (!membershipRole) {
      throw new NotFoundException("Knowledge base not found");
    }

    if (!allowedRoles.includes(membershipRole)) {
      throw new ForbiddenException("Knowledge base access denied");
    }

    return {
      kb,
      membershipRole,
    };
  }

  async assertDocumentRead<TInclude extends Prisma.DocumentInclude | undefined>(
    user: AuthenticatedUser,
    documentId: string,
    include?: TInclude,
  ) {
    const document = (await this.prisma.document.findFirst({
      where: this.buildDocumentReadWhere(user, documentId),
      include,
    })) as Prisma.DocumentGetPayload<{ include: TInclude }> | null;

    if (!document) {
      throw new NotFoundException("Document not found");
    }

    return document;
  }

  compareKbRoles(left: KbRole, right: KbRole) {
    return KB_ROLE_PRIORITY[left] - KB_ROLE_PRIORITY[right];
  }
}
