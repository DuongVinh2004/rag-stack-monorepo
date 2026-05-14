ALTER TYPE "SystemRole"
ADD VALUE IF NOT EXISTS 'OPERATOR';

ALTER TABLE "AuditLog"
ADD COLUMN "kbId" UUID;

ALTER TABLE "AuditLog"
ADD CONSTRAINT "AuditLog_kbId_fkey"
FOREIGN KEY ("kbId") REFERENCES "KnowledgeBase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "AuditLog_kbId_createdAt_idx"
ON "AuditLog"("kbId", "createdAt" DESC);

CREATE TABLE "RefreshSession" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt" TIMESTAMP(3),

  CONSTRAINT "RefreshSession_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "RefreshSession"
ADD CONSTRAINT "RefreshSession_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "RefreshSession_userId_revokedAt_idx"
ON "RefreshSession"("userId", "revokedAt");

CREATE INDEX "RefreshSession_expiresAt_idx"
ON "RefreshSession"("expiresAt");
