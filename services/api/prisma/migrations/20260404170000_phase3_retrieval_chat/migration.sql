CREATE TYPE "ConversationStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "MessageRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM');

CREATE TABLE "Conversation" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "kbId" UUID NOT NULL,
  "title" TEXT,
  "status" "ConversationStatus" NOT NULL DEFAULT 'ACTIVE',
  "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Message" (
  "id" UUID NOT NULL,
  "conversationId" UUID NOT NULL,
  "role" "MessageRole" NOT NULL,
  "content" TEXT NOT NULL,
  "latencyMs" INTEGER,
  "usageJson" JSONB,
  "retrievalMetaJson" JSONB,
  "modelName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Citation" (
  "id" UUID NOT NULL,
  "messageId" UUID NOT NULL,
  "chunkId" UUID NOT NULL,
  "rank" INTEGER NOT NULL,
  "score" DOUBLE PRECISION NOT NULL,
  "snippet" TEXT NOT NULL,
  "pageNumber" INTEGER,
  "sectionTitle" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Citation_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Conversation"
ADD CONSTRAINT "Conversation_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Conversation"
ADD CONSTRAINT "Conversation_kbId_fkey"
FOREIGN KEY ("kbId") REFERENCES "KnowledgeBase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Message"
ADD CONSTRAINT "Message_conversationId_fkey"
FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Citation"
ADD CONSTRAINT "Citation_messageId_fkey"
FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Citation"
ADD CONSTRAINT "Citation_chunkId_fkey"
FOREIGN KEY ("chunkId") REFERENCES "DocumentChunk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "Conversation_userId_lastActivityAt_idx"
ON "Conversation"("userId", "lastActivityAt" DESC);

CREATE INDEX "Conversation_kbId_lastActivityAt_idx"
ON "Conversation"("kbId", "lastActivityAt" DESC);

CREATE INDEX "Message_conversationId_createdAt_idx"
ON "Message"("conversationId", "createdAt");

CREATE UNIQUE INDEX "Citation_messageId_chunkId_key"
ON "Citation"("messageId", "chunkId");

CREATE INDEX "Citation_messageId_rank_idx"
ON "Citation"("messageId", "rank");

CREATE INDEX "Citation_chunkId_idx"
ON "Citation"("chunkId");
