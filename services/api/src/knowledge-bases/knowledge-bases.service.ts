import {
  Injectable,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateKnowledgeBaseDto, UpdateKnowledgeBaseDto } from "./dto/kb.dto";
import { KbRole, KbStatus } from "@prisma/client";
import { AuditService } from "../common/audit/audit.service";
import { AddMemberDto } from "./dto/member.dto";
import { AuthorizationService } from "../common/authorization/authorization.service";
import { AuthenticatedUser } from "../common/authorization/authorization.types";
import { slugifyKnowledgeBaseName } from "./kb-slug";

@Injectable()
export class KnowledgeBasesService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private readonly authorization: AuthorizationService,
  ) {}

  async create(user: AuthenticatedUser, dto: CreateKnowledgeBaseDto) {
    const slug = await this.generateUniqueSlug(dto.name);
    const kb = await this.prisma.knowledgeBase.create({
      data: {
        ...dto,
        slug,
        status: KbStatus.ACTIVE,
        members: {
          create: {
            userId: user.id,
            role: KbRole.OWNER,
          },
        },
      },
    });
    await this.audit.logAction({
      actorId: user.id,
      action: "KB_CREATE",
      entityType: "KnowledgeBase",
      entityId: kb.id,
      kbId: kb.id,
      metadata: {
        name: kb.name,
        visibility: kb.visibility,
      },
    });
    return kb;
  }

  async findAll(user: AuthenticatedUser) {
    const knowledgeBases = await this.prisma.knowledgeBase.findMany({
      where: this.authorization.buildKnowledgeBaseReadWhere(user),
      include: {
        members: {
          where: { userId: user.id },
          select: { role: true },
          take: 1,
        },
      },
      orderBy: [{ updatedAt: "desc" }],
    });

    return knowledgeBases.map((kb) => ({
      id: kb.id,
      slug: kb.slug,
      name: kb.name,
      description: kb.description,
      status: kb.status,
      visibility: kb.visibility,
      createdAt: kb.createdAt,
      updatedAt: kb.updatedAt,
      currentUserRole: this.authorization.isAdmin(user)
        ? "ADMIN"
        : (kb.members[0]?.role ?? null),
    }));
  }

  async findOne(id: string, user: AuthenticatedUser) {
    const kb = await this.authorization.assertKnowledgeBaseRead(user, id, {
      members: {
        where: { userId: user.id },
        select: {
          role: true,
          userId: true,
        },
        take: 1,
      },
      _count: {
        select: {
          members: true,
          documents: true,
        },
      },
    });

    const membership = kb.members[0] ?? null;

    return {
      id: kb.id,
      slug: kb.slug,
      name: kb.name,
      description: kb.description,
      status: kb.status,
      visibility: kb.visibility,
      createdAt: kb.createdAt,
      updatedAt: kb.updatedAt,
      currentUserRole: this.authorization.isAdmin(user)
        ? "ADMIN"
        : (membership?.role ?? null),
      memberCount: kb._count.members,
      documentCount: kb._count.documents,
    };
  }

  async update(
    id: string,
    user: AuthenticatedUser,
    dto: UpdateKnowledgeBaseDto,
  ) {
    await this.assertKbAccess(id, user, [KbRole.OWNER, KbRole.EDITOR]);
    const kb = await this.prisma.knowledgeBase.update({
      where: { id },
      data: dto,
    });
    await this.audit.logAction({
      actorId: user.id,
      action: "KB_UPDATE",
      entityType: "KnowledgeBase",
      entityId: id,
      kbId: id,
      metadata: { ...dto },
    });
    return kb;
  }

  async remove(id: string, user: AuthenticatedUser) {
    await this.assertKbAccess(id, user, [KbRole.OWNER]);
    await this.audit.logAction({
      actorId: user.id,
      action: "KB_ARCHIVE",
      entityType: "KnowledgeBase",
      entityId: id,
      kbId: id,
    });
    return this.prisma.knowledgeBase.update({
      where: { id },
      data: {
        status: KbStatus.ARCHIVED,
        archivedAt: new Date(),
      },
    });
  }

  async getMembers(kbId: string, user: AuthenticatedUser) {
    await this.assertKbAccess(kbId, user, [KbRole.OWNER, KbRole.EDITOR]);
    return this.prisma.kbMember.findMany({
      where: { kbId },
      include: { user: { select: { id: true, email: true } } },
    });
  }

  async addMember(kbId: string, author: AuthenticatedUser, dto: AddMemberDto) {
    await this.assertKbAccess(kbId, author, [KbRole.OWNER]);
    await this.ensureTargetUserExists(dto.userId);
    await this.ensureOwnerMutationAllowed(kbId, dto.userId, dto.role);
    const member = await this.prisma.kbMember.upsert({
      where: { kbId_userId: { kbId, userId: dto.userId } },
      update: { role: dto.role },
      create: { kbId, userId: dto.userId, role: dto.role },
    });
    await this.audit.logAction({
      actorId: author.id,
      action: "KB_MEMBER_UPSERT",
      entityType: "KbMember",
      entityId: `${kbId}:${dto.userId}`,
      kbId,
      metadata: { role: dto.role },
    });
    return member;
  }

  async removeMember(
    kbId: string,
    author: AuthenticatedUser,
    targetUserId: string,
  ) {
    await this.assertKbAccess(kbId, author, [KbRole.OWNER]);
    if (author.id === targetUserId) {
      throw new ForbiddenException("Cannot remove yourself as an owner");
    }
    await this.ensureOwnerMutationAllowed(kbId, targetUserId, null);
    await this.prisma.kbMember.delete({
      where: { kbId_userId: { kbId, userId: targetUserId } },
    });
    await this.audit.logAction({
      actorId: author.id,
      action: "KB_MEMBER_REMOVE",
      entityType: "KbMember",
      entityId: `${kbId}:${targetUserId}`,
      kbId,
      metadata: { targetUserId },
    });
    return { success: true };
  }

  async assertKbAccess(
    kbId: string,
    user: AuthenticatedUser,
    allowedRoles: KbRole[],
  ) {
    const access = await this.authorization.assertKnowledgeBaseRole(
      user,
      kbId,
      allowedRoles,
    );
    return access.membershipRole;
  }

  private async generateUniqueSlug(name: string) {
    const baseSlug = slugifyKnowledgeBaseName(name);
    let candidate = baseSlug;
    let suffix = 2;

    while (
      await this.prisma.knowledgeBase.findUnique({ where: { slug: candidate } })
    ) {
      candidate = `${baseSlug}-${suffix}`;
      suffix += 1;
    }

    return candidate;
  }

  private async ensureTargetUserExists(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) {
      throw new NotFoundException("User not found");
    }
  }

  private async ensureOwnerMutationAllowed(
    kbId: string,
    targetUserId: string,
    nextRole: KbRole | null,
  ) {
    const existingMember = await this.prisma.kbMember.findUnique({
      where: { kbId_userId: { kbId, userId: targetUserId } },
      select: { role: true },
    });

    if (
      !existingMember ||
      existingMember.role !== KbRole.OWNER ||
      nextRole === KbRole.OWNER
    ) {
      return;
    }

    const ownerCount = await this.prisma.kbMember.count({
      where: { kbId, role: KbRole.OWNER },
    });
    if (ownerCount <= 1) {
      throw new ForbiddenException(
        "Knowledge base must retain at least one owner",
      );
    }
  }
}
