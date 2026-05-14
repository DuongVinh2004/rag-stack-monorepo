ALTER TABLE "Citation"
ADD COLUMN "documentId" UUID,
ADD COLUMN "documentTitle" TEXT;

UPDATE "Citation" AS c
SET
  "documentId" = dc."documentId",
  "documentTitle" = d."name"
FROM "DocumentChunk" AS dc
JOIN "Document" AS d ON d."id" = dc."documentId"
WHERE c."chunkId" = dc."id";

ALTER TABLE "Citation"
ALTER COLUMN "documentId" SET NOT NULL,
ALTER COLUMN "documentTitle" SET NOT NULL;

ALTER TABLE "Citation"
ADD CONSTRAINT "Citation_documentId_fkey"
FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "Citation_documentId_idx"
ON "Citation"("documentId");
