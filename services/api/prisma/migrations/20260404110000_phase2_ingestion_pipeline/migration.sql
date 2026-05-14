CREATE TYPE "DocumentVersionStatus" AS ENUM ('QUEUED', 'PROCESSING', 'INDEXED', 'FAILED');
CREATE TYPE "VectorizationStatus" AS ENUM ('PENDING', 'DISABLED', 'COMPLETED', 'FAILED');

ALTER TABLE "KnowledgeBase"
ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "Document"
ADD COLUMN IF NOT EXISTS "lastErrorCode" TEXT,
ADD COLUMN IF NOT EXISTS "lastErrorMessage" TEXT,
ADD COLUMN IF NOT EXISTS "indexedAt" TIMESTAMP(3);

ALTER TABLE "DocumentVersion"
ADD COLUMN IF NOT EXISTS "status" "DocumentVersionStatus" NOT NULL DEFAULT 'QUEUED',
ADD COLUMN IF NOT EXISTS "ingestVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN IF NOT EXISTS "pipelineVersion" TEXT NOT NULL DEFAULT 'phase2.v1',
ADD COLUMN IF NOT EXISTS "vectorizationStatus" "VectorizationStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN IF NOT EXISTS "chunkCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "lastErrorCode" TEXT,
ADD COLUMN IF NOT EXISTS "lastErrorMessage" TEXT,
ADD COLUMN IF NOT EXISTS "startedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "finishedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "indexedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "DocumentVersion" AS dv
SET
  "status" = CASE d."status"
    WHEN 'INDEXED' THEN 'INDEXED'::"DocumentVersionStatus"
    WHEN 'FAILED' THEN 'FAILED'::"DocumentVersionStatus"
    WHEN 'PROCESSING' THEN 'PROCESSING'::"DocumentVersionStatus"
    ELSE 'QUEUED'::"DocumentVersionStatus"
  END,
  "vectorizationStatus" = CASE d."status"
    WHEN 'INDEXED' THEN 'DISABLED'::"VectorizationStatus"
    ELSE 'PENDING'::"VectorizationStatus"
  END
FROM "Document" AS d
WHERE dv."documentId" = d."id";

CREATE UNIQUE INDEX IF NOT EXISTS "DocumentVersion_documentId_versionNumber_key"
ON "DocumentVersion"("documentId", "versionNumber");

ALTER TABLE "IngestJob"
RENAME COLUMN "completedAt" TO "finishedAt";

ALTER TABLE "IngestJob"
ADD COLUMN IF NOT EXISTS "errorMessage" TEXT,
ADD COLUMN IF NOT EXISTS "maxAttempts" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN IF NOT EXISTS "correlationId" TEXT,
ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE "DocumentChunk" (
  "id" UUID NOT NULL,
  "documentId" UUID NOT NULL,
  "documentVersionId" UUID NOT NULL,
  "kbId" UUID NOT NULL,
  "chunkNo" INTEGER NOT NULL,
  "content" TEXT NOT NULL,
  "searchText" TEXT NOT NULL,
  "tokenCount" INTEGER NOT NULL,
  "sectionTitle" TEXT,
  "pageNumber" INTEGER,
  "sourceTitle" TEXT,
  "language" TEXT,
  "chunkingStrategy" TEXT NOT NULL,
  "chunkingVersion" TEXT NOT NULL,
  "embeddingModel" TEXT,
  "embeddingDim" INTEGER,
  "embedding" vector,
  "checksum" TEXT NOT NULL,
  "metadataJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DocumentChunk_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "DocumentChunk"
ADD CONSTRAINT "DocumentChunk_documentId_fkey"
FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DocumentChunk"
ADD CONSTRAINT "DocumentChunk_documentVersionId_fkey"
FOREIGN KEY ("documentVersionId") REFERENCES "DocumentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DocumentChunk"
ADD CONSTRAINT "DocumentChunk_kbId_fkey"
FOREIGN KEY ("kbId") REFERENCES "KnowledgeBase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "DocumentChunk_documentVersionId_chunkNo_key"
ON "DocumentChunk"("documentVersionId", "chunkNo");

CREATE INDEX "DocumentChunk_documentVersionId_idx"
ON "DocumentChunk"("documentVersionId");

CREATE INDEX "DocumentChunk_kbId_idx"
ON "DocumentChunk"("kbId");

CREATE INDEX "DocumentChunk_documentId_idx"
ON "DocumentChunk"("documentId");

CREATE INDEX "DocumentChunk_searchText_tsv_idx"
ON "DocumentChunk"
USING GIN (to_tsvector('simple', "searchText"));
