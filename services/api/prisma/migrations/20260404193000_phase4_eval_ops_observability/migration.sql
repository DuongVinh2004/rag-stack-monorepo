CREATE TYPE "EvalSetStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "EvalCaseStatus" AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE "EvalRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

CREATE TABLE "EvalSet" (
  "id" UUID NOT NULL,
  "kbId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "status" "EvalSetStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "EvalSet_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EvalCase" (
  "id" UUID NOT NULL,
  "evalSetId" UUID NOT NULL,
  "question" TEXT NOT NULL,
  "expectedAnswer" TEXT,
  "expectedSourceDocumentId" UUID,
  "expectedSourceHint" TEXT,
  "category" TEXT NOT NULL DEFAULT 'general',
  "difficulty" TEXT NOT NULL DEFAULT 'medium',
  "status" "EvalCaseStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "EvalCase_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EvalRun" (
  "id" UUID NOT NULL,
  "evalSetId" UUID NOT NULL,
  "kbId" UUID NOT NULL,
  "modelName" TEXT NOT NULL,
  "retrievalConfigJson" JSONB NOT NULL,
  "promptVersion" TEXT NOT NULL,
  "chunkingVersion" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "status" "EvalRunStatus" NOT NULL DEFAULT 'RUNNING',
  "summaryJson" JSONB,

  CONSTRAINT "EvalRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EvalItem" (
  "id" UUID NOT NULL,
  "evalRunId" UUID NOT NULL,
  "evalCaseId" UUID NOT NULL,
  "actualAnswer" TEXT NOT NULL,
  "retrievedSourcesJson" JSONB NOT NULL,
  "passed" BOOLEAN NOT NULL,
  "score" DOUBLE PRECISION NOT NULL,
  "notes" TEXT,
  "regressionFlag" BOOLEAN NOT NULL DEFAULT FALSE,
  "latencyMs" INTEGER,
  "usageJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "EvalItem_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "EvalSet"
ADD CONSTRAINT "EvalSet_kbId_fkey"
FOREIGN KEY ("kbId") REFERENCES "KnowledgeBase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EvalCase"
ADD CONSTRAINT "EvalCase_evalSetId_fkey"
FOREIGN KEY ("evalSetId") REFERENCES "EvalSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EvalRun"
ADD CONSTRAINT "EvalRun_evalSetId_fkey"
FOREIGN KEY ("evalSetId") REFERENCES "EvalSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EvalItem"
ADD CONSTRAINT "EvalItem_evalRunId_fkey"
FOREIGN KEY ("evalRunId") REFERENCES "EvalRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EvalItem"
ADD CONSTRAINT "EvalItem_evalCaseId_fkey"
FOREIGN KEY ("evalCaseId") REFERENCES "EvalCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "EvalSet_kbId_name_key"
ON "EvalSet"("kbId", "name");

CREATE INDEX "EvalSet_kbId_createdAt_idx"
ON "EvalSet"("kbId", "createdAt" DESC);

CREATE INDEX "EvalCase_evalSetId_status_idx"
ON "EvalCase"("evalSetId", "status");

CREATE INDEX "EvalRun_evalSetId_startedAt_idx"
ON "EvalRun"("evalSetId", "startedAt" DESC);

CREATE INDEX "EvalRun_kbId_startedAt_idx"
ON "EvalRun"("kbId", "startedAt" DESC);

CREATE INDEX "EvalRun_status_startedAt_idx"
ON "EvalRun"("status", "startedAt" DESC);

CREATE UNIQUE INDEX "EvalItem_evalRunId_evalCaseId_key"
ON "EvalItem"("evalRunId", "evalCaseId");

CREATE INDEX "EvalItem_evalRunId_regressionFlag_idx"
ON "EvalItem"("evalRunId", "regressionFlag");

CREATE INDEX "EvalItem_evalCaseId_idx"
ON "EvalItem"("evalCaseId");
