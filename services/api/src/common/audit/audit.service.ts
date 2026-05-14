import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

type AuditMetadata =
  | string
  | number
  | boolean
  | null
  | AuditMetadata[]
  | { [key: string]: AuditMetadata | undefined };

type AuditLogInput = {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  kbId?: string | null;
  metadata?: AuditMetadata;
};

const REDACTED_KEYS = new Set([
  'password',
  'passwordhash',
  'token',
  'accesstoken',
  'refreshtoken',
  'secret',
  'authorization',
  'content',
]);

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  async logAction(
    actorIdOrInput: string | null | AuditLogInput,
    entityType?: string,
    entityId?: string,
    action?: string,
    payload?: AuditMetadata,
  ) {
    let input: AuditLogInput;
    if (typeof actorIdOrInput === 'object' && actorIdOrInput !== null) {
      input = actorIdOrInput;
    } else {
      input = {
        actorId: actorIdOrInput as string | null,
        action: action ?? 'UNKNOWN',
        entityType: entityType ?? 'UnknownEntity',
        entityId: entityId ?? 'unknown-entity-id',
        metadata: payload,
      };
    }

    return this.prisma.auditLog.create({
      data: {
        actorId: input.actorId,
        entityType: input.entityType,
        entityId: input.entityId,
        action: input.action,
        kbId: input.kbId ?? null,
        payload: this.sanitizeMetadata(input.metadata),
      },
    });
  }

  private sanitizeMetadata(metadata: AuditMetadata | undefined, depth = 0): AuditMetadata {
    if (metadata === undefined) {
      return {};
    }

    if (metadata === null || typeof metadata === 'number' || typeof metadata === 'boolean') {
      return metadata;
    }

    if (typeof metadata === 'string') {
      return metadata.length > 200 ? `${metadata.slice(0, 197)}...` : metadata;
    }

    if (Array.isArray(metadata)) {
      return metadata.slice(0, 20).map((value) => this.sanitizeMetadata(value, depth + 1));
    }

    if (depth >= 2) {
      return '[truncated]';
    }

    return Object.entries(metadata).reduce<Record<string, AuditMetadata>>((acc, [key, value]) => {
      const normalizedKey = key.toLowerCase();
      if (REDACTED_KEYS.has(normalizedKey)) {
        acc[key] = '[redacted]';
        return acc;
      }

      acc[key] = this.sanitizeMetadata(value ?? null, depth + 1);
      return acc;
    }, {});
  }
}
