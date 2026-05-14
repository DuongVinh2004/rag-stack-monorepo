CREATE EXTENSION IF NOT EXISTS citext;

DO $$
BEGIN
  CREATE TYPE "KbStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "User"
ALTER COLUMN "email" TYPE CITEXT
USING "email"::citext;

ALTER TABLE "KnowledgeBase"
ADD COLUMN IF NOT EXISTS "slug" CITEXT,
ADD COLUMN IF NOT EXISTS "status" "KbStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);

WITH normalized AS (
  SELECT
    kb."id",
    LEFT(
      COALESCE(
        NULLIF(TRIM(BOTH '-' FROM regexp_replace(lower(kb."name"), '[^a-z0-9]+', '-', 'g')), ''),
        'knowledge-base'
      ),
      48
    ) AS base_slug,
    ROW_NUMBER() OVER (
      PARTITION BY LEFT(
        COALESCE(
          NULLIF(TRIM(BOTH '-' FROM regexp_replace(lower(kb."name"), '[^a-z0-9]+', '-', 'g')), ''),
          'knowledge-base'
        ),
        48
      )
      ORDER BY kb."createdAt", kb."id"
    ) AS slug_rank
  FROM "KnowledgeBase" kb
)
UPDATE "KnowledgeBase" kb
SET "slug" = CASE
  WHEN normalized.slug_rank = 1 THEN normalized.base_slug
  ELSE CONCAT(normalized.base_slug, '-', normalized.slug_rank)
END
FROM normalized
WHERE kb."id" = normalized."id" AND kb."slug" IS NULL;

ALTER TABLE "KnowledgeBase"
ALTER COLUMN "slug" SET NOT NULL;

ALTER TABLE "DocumentVersion"
ADD COLUMN IF NOT EXISTS "storageBucket" TEXT;

ALTER TABLE "IngestJob"
ADD COLUMN IF NOT EXISTS "retryable" BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE "DocumentChunk"
ADD COLUMN IF NOT EXISTS "supersededAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "KnowledgeBase_slug_key"
ON "KnowledgeBase"("slug");

CREATE INDEX IF NOT EXISTS "KnowledgeBase_status_updatedAt_idx"
ON "KnowledgeBase"("status", "updatedAt" DESC);

CREATE INDEX IF NOT EXISTS "KbMember_userId_kbId_idx"
ON "KbMember"("userId", "kbId");

CREATE UNIQUE INDEX IF NOT EXISTS "RefreshSession_tokenHash_key"
ON "RefreshSession"("tokenHash");

CREATE UNIQUE INDEX IF NOT EXISTS "Document_id_kbId_key"
ON "Document"("id", "kbId");

CREATE INDEX IF NOT EXISTS "Document_kbId_createdAt_idx"
ON "Document"("kbId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "Document_kbId_status_createdAt_idx"
ON "Document"("kbId", "status", "createdAt" DESC);

CREATE UNIQUE INDEX IF NOT EXISTS "DocumentVersion_id_documentId_key"
ON "DocumentVersion"("id", "documentId");

CREATE INDEX IF NOT EXISTS "IngestJob_documentVersionId_createdAt_idx"
ON "IngestJob"("documentVersionId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "IngestJob_failed_terminal_idx"
ON "IngestJob"("finishedAt" DESC, "updatedAt" DESC)
WHERE "status" IN ('FAILED', 'DEAD_LETTER');

DROP INDEX IF EXISTS "DocumentChunk_documentVersionId_chunkNo_key";
DROP INDEX IF EXISTS "DocumentChunk_documentVersionId_idx";
DROP INDEX IF EXISTS "DocumentChunk_kbId_idx";
DROP INDEX IF EXISTS "DocumentChunk_documentId_idx";
DROP INDEX IF EXISTS "DocumentChunk_searchText_tsv_idx";

CREATE UNIQUE INDEX IF NOT EXISTS "DocumentChunk_id_documentId_key"
ON "DocumentChunk"("id", "documentId");

CREATE UNIQUE INDEX IF NOT EXISTS "DocumentChunk_active_version_chunk_key"
ON "DocumentChunk"("documentVersionId", "chunkNo")
WHERE "supersededAt" IS NULL;

CREATE INDEX IF NOT EXISTS "DocumentChunk_documentVersionId_supersededAt_idx"
ON "DocumentChunk"("documentVersionId", "supersededAt");

CREATE INDEX IF NOT EXISTS "DocumentChunk_documentId_supersededAt_idx"
ON "DocumentChunk"("documentId", "supersededAt");

CREATE INDEX IF NOT EXISTS "DocumentChunk_kbId_supersededAt_idx"
ON "DocumentChunk"("kbId", "supersededAt");

CREATE INDEX IF NOT EXISTS "DocumentChunk_kbId_embeddingModel_embeddingDim_supersededAt_idx"
ON "DocumentChunk"("kbId", "embeddingModel", "embeddingDim", "supersededAt");

CREATE INDEX IF NOT EXISTS "DocumentChunk_searchText_tsv_idx"
ON "DocumentChunk"
USING GIN (to_tsvector('simple', "searchText"))
WHERE "supersededAt" IS NULL;

CREATE INDEX IF NOT EXISTS "AuditLog_actorId_createdAt_idx"
ON "AuditLog"("actorId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "AuditLog_action_createdAt_idx"
ON "AuditLog"("action", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "AuditLog_entityType_entityId_createdAt_idx"
ON "AuditLog"("entityType", "entityId", "createdAt" DESC);

CREATE UNIQUE INDEX IF NOT EXISTS "EvalSet_id_kbId_key"
ON "EvalSet"("id", "kbId");

CREATE INDEX IF NOT EXISTS "EvalCase_expectedSourceDocumentId_idx"
ON "EvalCase"("expectedSourceDocumentId");

CREATE INDEX IF NOT EXISTS "EvalItem_evalRunId_createdAt_idx"
ON "EvalItem"("evalRunId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'DocumentVersion_versionNumber_check'
  ) THEN
    ALTER TABLE "DocumentVersion"
    ADD CONSTRAINT "DocumentVersion_versionNumber_check" CHECK ("versionNumber" > 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'DocumentVersion_ingestVersion_check'
  ) THEN
    ALTER TABLE "DocumentVersion"
    ADD CONSTRAINT "DocumentVersion_ingestVersion_check" CHECK ("ingestVersion" > 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'DocumentVersion_chunkCount_check'
  ) THEN
    ALTER TABLE "DocumentVersion"
    ADD CONSTRAINT "DocumentVersion_chunkCount_check" CHECK ("chunkCount" >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'IngestJob_attempts_check'
  ) THEN
    ALTER TABLE "IngestJob"
    ADD CONSTRAINT "IngestJob_attempts_check" CHECK ("attempts" >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'IngestJob_maxAttempts_check'
  ) THEN
    ALTER TABLE "IngestJob"
    ADD CONSTRAINT "IngestJob_maxAttempts_check" CHECK ("maxAttempts" > 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'IngestJob_attempts_lte_maxAttempts_check'
  ) THEN
    ALTER TABLE "IngestJob"
    ADD CONSTRAINT "IngestJob_attempts_lte_maxAttempts_check" CHECK ("attempts" <= "maxAttempts");
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'DocumentChunk_chunkNo_check'
  ) THEN
    ALTER TABLE "DocumentChunk"
    ADD CONSTRAINT "DocumentChunk_chunkNo_check" CHECK ("chunkNo" > 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'DocumentChunk_tokenCount_check'
  ) THEN
    ALTER TABLE "DocumentChunk"
    ADD CONSTRAINT "DocumentChunk_tokenCount_check" CHECK ("tokenCount" > 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'DocumentChunk_chunkingStrategy_check'
  ) THEN
    ALTER TABLE "DocumentChunk"
    ADD CONSTRAINT "DocumentChunk_chunkingStrategy_check" CHECK (length(trim("chunkingStrategy")) > 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'DocumentChunk_chunkingVersion_check'
  ) THEN
    ALTER TABLE "DocumentChunk"
    ADD CONSTRAINT "DocumentChunk_chunkingVersion_check" CHECK (length(trim("chunkingVersion")) > 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'DocumentChunk_checksum_check'
  ) THEN
    ALTER TABLE "DocumentChunk"
    ADD CONSTRAINT "DocumentChunk_checksum_check" CHECK (length(trim("checksum")) > 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'DocumentChunk_embedding_consistency_check'
  ) THEN
    ALTER TABLE "DocumentChunk"
    ADD CONSTRAINT "DocumentChunk_embedding_consistency_check"
    CHECK (
      (
        "embedding" IS NULL
        AND "embeddingModel" IS NULL
        AND "embeddingDim" IS NULL
      )
      OR (
        "embedding" IS NOT NULL
        AND "embeddingModel" IS NOT NULL
        AND "embeddingDim" IS NOT NULL
        AND "embeddingDim" > 0
        AND vector_dims("embedding") = "embeddingDim"
      )
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'DocumentChunk_metadataJson_object_check'
  ) THEN
    ALTER TABLE "DocumentChunk"
    ADD CONSTRAINT "DocumentChunk_metadataJson_object_check"
    CHECK ("metadataJson" IS NULL OR jsonb_typeof("metadataJson") = 'object');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Message_usageJson_object_check'
  ) THEN
    ALTER TABLE "Message"
    ADD CONSTRAINT "Message_usageJson_object_check"
    CHECK ("usageJson" IS NULL OR jsonb_typeof("usageJson") = 'object');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Message_retrievalMetaJson_object_check'
  ) THEN
    ALTER TABLE "Message"
    ADD CONSTRAINT "Message_retrievalMetaJson_object_check"
    CHECK ("retrievalMetaJson" IS NULL OR jsonb_typeof("retrievalMetaJson") = 'object');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'EvalRun_retrievalConfigJson_object_check'
  ) THEN
    ALTER TABLE "EvalRun"
    ADD CONSTRAINT "EvalRun_retrievalConfigJson_object_check"
    CHECK (jsonb_typeof("retrievalConfigJson") = 'object');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'EvalRun_summaryJson_object_check'
  ) THEN
    ALTER TABLE "EvalRun"
    ADD CONSTRAINT "EvalRun_summaryJson_object_check"
    CHECK ("summaryJson" IS NULL OR jsonb_typeof("summaryJson") = 'object');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'EvalItem_retrievedSourcesJson_object_check'
  ) THEN
    ALTER TABLE "EvalItem"
    ADD CONSTRAINT "EvalItem_retrievedSourcesJson_object_check"
    CHECK (jsonb_typeof("retrievedSourcesJson") = 'object');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'EvalItem_usageJson_object_check'
  ) THEN
    ALTER TABLE "EvalItem"
    ADD CONSTRAINT "EvalItem_usageJson_object_check"
    CHECK ("usageJson" IS NULL OR jsonb_typeof("usageJson") = 'object');
  END IF;
END $$;

ALTER TABLE "Document" DROP CONSTRAINT IF EXISTS "Document_kbId_fkey";
ALTER TABLE "DocumentVersion" DROP CONSTRAINT IF EXISTS "DocumentVersion_documentId_fkey";
ALTER TABLE "IngestJob" DROP CONSTRAINT IF EXISTS "IngestJob_documentVersionId_fkey";
ALTER TABLE "DocumentChunk" DROP CONSTRAINT IF EXISTS "DocumentChunk_documentId_fkey";
ALTER TABLE "DocumentChunk" DROP CONSTRAINT IF EXISTS "DocumentChunk_documentVersionId_fkey";
ALTER TABLE "DocumentChunk" DROP CONSTRAINT IF EXISTS "DocumentChunk_kbId_fkey";
ALTER TABLE "Conversation" DROP CONSTRAINT IF EXISTS "Conversation_userId_fkey";
ALTER TABLE "Conversation" DROP CONSTRAINT IF EXISTS "Conversation_kbId_fkey";
ALTER TABLE "Citation" DROP CONSTRAINT IF EXISTS "Citation_chunkId_fkey";
ALTER TABLE "Citation" DROP CONSTRAINT IF EXISTS "Citation_documentId_fkey";
ALTER TABLE "EvalSet" DROP CONSTRAINT IF EXISTS "EvalSet_kbId_fkey";
ALTER TABLE "EvalCase" DROP CONSTRAINT IF EXISTS "EvalCase_evalSetId_fkey";
ALTER TABLE "EvalCase" DROP CONSTRAINT IF EXISTS "EvalCase_expectedSourceDocumentId_fkey";
ALTER TABLE "EvalRun" DROP CONSTRAINT IF EXISTS "EvalRun_evalSetId_fkey";
ALTER TABLE "EvalRun" DROP CONSTRAINT IF EXISTS "EvalRun_kbId_fkey";

ALTER TABLE "Document"
ADD CONSTRAINT "Document_kbId_fkey"
FOREIGN KEY ("kbId") REFERENCES "KnowledgeBase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DocumentVersion"
ADD CONSTRAINT "DocumentVersion_documentId_fkey"
FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "IngestJob"
ADD CONSTRAINT "IngestJob_documentVersionId_fkey"
FOREIGN KEY ("documentVersionId") REFERENCES "DocumentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DocumentChunk"
ADD CONSTRAINT "DocumentChunk_kbId_fkey"
FOREIGN KEY ("kbId") REFERENCES "KnowledgeBase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DocumentChunk"
ADD CONSTRAINT "DocumentChunk_document_kb_consistency_fkey"
FOREIGN KEY ("documentId", "kbId") REFERENCES "Document"("id", "kbId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DocumentChunk"
ADD CONSTRAINT "DocumentChunk_version_document_consistency_fkey"
FOREIGN KEY ("documentVersionId", "documentId") REFERENCES "DocumentVersion"("id", "documentId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Conversation"
ADD CONSTRAINT "Conversation_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Conversation"
ADD CONSTRAINT "Conversation_kbId_fkey"
FOREIGN KEY ("kbId") REFERENCES "KnowledgeBase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Citation"
ADD CONSTRAINT "Citation_documentId_fkey"
FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Citation"
ADD CONSTRAINT "Citation_chunk_document_consistency_fkey"
FOREIGN KEY ("chunkId", "documentId") REFERENCES "DocumentChunk"("id", "documentId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EvalSet"
ADD CONSTRAINT "EvalSet_kbId_fkey"
FOREIGN KEY ("kbId") REFERENCES "KnowledgeBase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EvalCase"
ADD CONSTRAINT "EvalCase_evalSetId_fkey"
FOREIGN KEY ("evalSetId") REFERENCES "EvalSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EvalCase"
ADD CONSTRAINT "EvalCase_expectedSourceDocumentId_fkey"
FOREIGN KEY ("expectedSourceDocumentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EvalRun"
ADD CONSTRAINT "EvalRun_evalSetId_fkey"
FOREIGN KEY ("evalSetId") REFERENCES "EvalSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EvalRun"
ADD CONSTRAINT "EvalRun_kbId_fkey"
FOREIGN KEY ("kbId") REFERENCES "KnowledgeBase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EvalRun"
ADD CONSTRAINT "EvalRun_evalSet_kb_consistency_fkey"
FOREIGN KEY ("evalSetId", "kbId") REFERENCES "EvalSet"("id", "kbId") ON DELETE RESTRICT ON UPDATE CASCADE;
