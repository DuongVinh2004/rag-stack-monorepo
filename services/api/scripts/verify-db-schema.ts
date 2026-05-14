import { randomBytes, randomUUID } from "crypto";
import { spawnSync } from "child_process";
import {
  DocumentStatus,
  KbRole,
  KbStatus,
  KbVisibility,
  PrismaClient,
  SystemRole,
} from "@prisma/client";

const serviceDir = process.cwd();

async function main() {
  const baseUrl = process.env.DATABASE_URL;
  if (!baseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const schemaName = `schema_verify_${randomBytes(6).toString("hex")}`;
  const schemaUrl = withSchema(baseUrl, schemaName);
  const admin = new PrismaClient({
    datasources: {
      db: {
        url: baseUrl,
      },
    },
  });

  try {
    await admin.$connect();
    await admin.$executeRawUnsafe(
      `CREATE SCHEMA IF NOT EXISTS "${schemaName}"`,
    );

    runApiCommand(["exec", "prisma", "migrate", "deploy"], schemaUrl);
    runApiCommand(["exec", "prisma", "db", "seed"], schemaUrl);
    runApiCommand(["run", "seed:demo"], schemaUrl);
    runApiCommand(["run", "seed:demo"], schemaUrl);

    const prisma = new PrismaClient({
      datasources: {
        db: {
          url: schemaUrl,
        },
      },
    });

    try {
      await prisma.$connect();
      await assertSeedIdempotency(prisma);
      await assertCaseInsensitiveEmailUniqueness(prisma);
      await assertMembershipUniqueness(prisma);
      await assertDocumentVersionUniqueness(prisma);
      await assertChunkLifecycleUniqueness(prisma);
      await assertCitationChunkConsistency(prisma);
      await assertDeleteRestrictions(prisma);
    } finally {
      await prisma.$disconnect();
    }

    console.log(
      JSON.stringify(
        {
          event: "db_schema_verification_passed",
          schema: schemaName,
        },
        null,
        2,
      ),
    );
  } finally {
    await admin.$executeRawUnsafe(
      `DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`,
    );
    await admin.$disconnect();
  }
}

function runApiCommand(args: string[], databaseUrl: string) {
  const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const result = spawnSync(command, args, {
    cwd: serviceDir,
    encoding: "utf8",
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
    },
  });

  if (result.status === 0) {
    return;
  }

  throw new Error(
    [
      `Command failed: pnpm ${args.join(" ")}`,
      result.stdout?.trim(),
      result.stderr?.trim(),
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

function withSchema(databaseUrl: string, schema: string) {
  const url = new URL(databaseUrl);
  url.searchParams.set("schema", schema);
  return url.toString();
}

async function assertSeedIdempotency(prisma: PrismaClient) {
  const [
    roles,
    users,
    knowledgeBases,
    memberships,
    userRoles,
    evalSets,
    evalCases,
  ] = await Promise.all([
    prisma.role.count(),
    prisma.user.count(),
    prisma.knowledgeBase.count(),
    prisma.kbMember.count(),
    prisma.userRole.count(),
    prisma.evalSet.count(),
    prisma.evalCase.count(),
  ]);

  assertEqual(
    roles,
    Object.values(SystemRole).length,
    "system roles should be seeded exactly once",
  );
  assertEqual(users, 3, "demo users should be upserted once");
  assertEqual(knowledgeBases, 1, "demo knowledge base should be upserted once");
  assertEqual(memberships, 3, "demo KB memberships should be upserted once");
  assertEqual(userRoles, 5, "demo user role bindings should be upserted once");
  assertEqual(evalSets, 1, "demo eval set should be upserted once");
  assertEqual(evalCases, 1, "demo eval case should be upserted once");

  const kb = await prisma.knowledgeBase.findFirstOrThrow();
  assertEqual(kb.status, KbStatus.ACTIVE, "seeded KB should stay active");
  assertEqual(
    kb.slug,
    "support-demo-kb",
    "seeded KB should use the deterministic slug",
  );
}

async function assertCaseInsensitiveEmailUniqueness(prisma: PrismaClient) {
  await prisma.user.create({
    data: {
      email: "CaseTest@example.com",
      passwordHash: "hash-1",
    },
  });

  await expectDatabaseFailure("case-insensitive user email uniqueness", () =>
    prisma.user.create({
      data: {
        email: "casetest@example.com",
        passwordHash: "hash-2",
      },
    }),
  );
}

async function assertMembershipUniqueness(prisma: PrismaClient) {
  const user = await prisma.user.create({
    data: {
      email: `member-${randomBytes(4).toString("hex")}@example.com`,
      passwordHash: "hash",
    },
  });
  const kb = await prisma.knowledgeBase.create({
    data: {
      slug: `member-kb-${randomBytes(4).toString("hex")}`,
      name: "Member KB",
      status: KbStatus.ACTIVE,
      visibility: KbVisibility.PRIVATE,
    },
  });

  await prisma.kbMember.create({
    data: {
      kbId: kb.id,
      userId: user.id,
      role: KbRole.OWNER,
    },
  });

  await expectDatabaseFailure("duplicate KB membership prevention", () =>
    prisma.kbMember.create({
      data: {
        kbId: kb.id,
        userId: user.id,
        role: KbRole.VIEWER,
      },
    }),
  );
}

async function assertDocumentVersionUniqueness(prisma: PrismaClient) {
  const { kb } = await createKbWithOwner(prisma, "Document Version KB");
  const document = await prisma.document.create({
    data: {
      kbId: kb.id,
      name: "Runbook",
      type: "text/plain",
      status: DocumentStatus.QUEUED,
    },
  });

  await prisma.documentVersion.create({
    data: {
      documentId: document.id,
      storageBucket: "knowledge-base-bucket",
      s3Key: "kb/runbook-v1.txt",
      contentHash: "hash-v1",
      versionNumber: 1,
    },
  });

  await expectDatabaseFailure("document version number uniqueness", () =>
    prisma.documentVersion.create({
      data: {
        documentId: document.id,
        storageBucket: "knowledge-base-bucket",
        s3Key: "kb/runbook-v1-duplicate.txt",
        contentHash: "hash-v1-dup",
        versionNumber: 1,
      },
    }),
  );
}

async function assertChunkLifecycleUniqueness(prisma: PrismaClient) {
  const fixture = await createIndexedChunkFixture(prisma, "Chunk Lifecycle KB");

  await prisma.documentChunk.create({
    data: {
      id: randomUUID(),
      documentId: fixture.document.id,
      documentVersionId: fixture.version.id,
      kbId: fixture.kb.id,
      chunkNo: 1,
      content: "Reset the worker before retrying.",
      searchText: "reset the worker before retrying",
      tokenCount: 6,
      sectionTitle: "Troubleshooting",
      pageNumber: 1,
      sourceTitle: fixture.document.name,
      language: "en",
      chunkingStrategy: "section",
      chunkingVersion: "section_v2",
      checksum: "chunk-check-1",
      metadataJson: { page_numbers: [1] },
    },
  });

  await expectDatabaseFailure("active chunk uniqueness", () =>
    prisma.documentChunk.create({
      data: {
        id: randomUUID(),
        documentId: fixture.document.id,
        documentVersionId: fixture.version.id,
        kbId: fixture.kb.id,
        chunkNo: 1,
        content: "A conflicting active chunk",
        searchText: "a conflicting active chunk",
        tokenCount: 4,
        chunkingStrategy: "section",
        chunkingVersion: "section_v2",
        checksum: "chunk-check-2",
      },
    }),
  );

  await prisma.documentChunk.updateMany({
    where: {
      documentVersionId: fixture.version.id,
      chunkNo: 1,
      supersededAt: null,
    },
    data: {
      supersededAt: new Date(),
    },
  });

  await prisma.documentChunk.create({
    data: {
      id: randomUUID(),
      documentId: fixture.document.id,
      documentVersionId: fixture.version.id,
      kbId: fixture.kb.id,
      chunkNo: 1,
      content: "The replacement active chunk",
      searchText: "the replacement active chunk",
      tokenCount: 4,
      chunkingStrategy: "section",
      chunkingVersion: "section_v2",
      checksum: "chunk-check-3",
    },
  });
}

async function assertCitationChunkConsistency(prisma: PrismaClient) {
  const fixture = await createIndexedChunkFixture(
    prisma,
    "Citation Integrity KB",
  );
  const chunk = await prisma.documentChunk.create({
    data: {
      id: randomUUID(),
      documentId: fixture.document.id,
      documentVersionId: fixture.version.id,
      kbId: fixture.kb.id,
      chunkNo: 1,
      content: "Collect the request id before escalating.",
      searchText: "collect the request id before escalating",
      tokenCount: 6,
      chunkingStrategy: "section",
      chunkingVersion: "section_v2",
      checksum: "citation-check-1",
    },
  });
  const otherDocument = await prisma.document.create({
    data: {
      kbId: fixture.kb.id,
      name: "Other Document",
      type: "text/plain",
      status: DocumentStatus.INDEXED,
    },
  });
  const conversation = await prisma.conversation.create({
    data: {
      userId: fixture.owner.id,
      kbId: fixture.kb.id,
      title: "Citation integrity",
    },
  });
  const message = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      role: "ASSISTANT",
      content: "Collect the request id before escalating.",
    },
  });

  await expectDatabaseFailure("citation chunk/document consistency", () =>
    prisma.citation.create({
      data: {
        messageId: message.id,
        chunkId: chunk.id,
        documentId: otherDocument.id,
        documentTitle: otherDocument.name,
        rank: 1,
        score: 0.98,
        snippet: "... request id ...",
      },
    }),
  );
}

async function assertDeleteRestrictions(prisma: PrismaClient) {
  const fixture = await createIndexedChunkFixture(prisma, "Delete Restrict KB");
  const conversation = await prisma.conversation.create({
    data: {
      userId: fixture.owner.id,
      kbId: fixture.kb.id,
      title: "Deletion boundary",
    },
  });
  await prisma.evalSet.create({
    data: {
      kbId: fixture.kb.id,
      name: "Deletion eval set",
    },
  });
  const chunk = await prisma.documentChunk.create({
    data: {
      id: randomUUID(),
      documentId: fixture.document.id,
      documentVersionId: fixture.version.id,
      kbId: fixture.kb.id,
      chunkNo: 1,
      content: "Deletion checks",
      searchText: "deletion checks",
      tokenCount: 2,
      chunkingStrategy: "section",
      chunkingVersion: "section_v2",
      checksum: "delete-check-1",
    },
  });
  const message = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      role: "ASSISTANT",
      content: "Deletion checks",
    },
  });
  await prisma.citation.create({
    data: {
      messageId: message.id,
      chunkId: chunk.id,
      documentId: fixture.document.id,
      documentTitle: fixture.document.name,
      rank: 1,
      score: 0.8,
      snippet: "... deletion checks ...",
    },
  });

  await expectDatabaseFailure(
    "knowledge base hard delete should be restricted",
    () => prisma.knowledgeBase.delete({ where: { id: fixture.kb.id } }),
  );

  await expectDatabaseFailure(
    "user hard delete should be restricted when conversations exist",
    () => prisma.user.delete({ where: { id: fixture.owner.id } }),
  );

  await expectDatabaseFailure(
    "document hard delete should be restricted when versioned evidence exists",
    () => prisma.document.delete({ where: { id: fixture.document.id } }),
  );
}

async function createKbWithOwner(prisma: PrismaClient, kbName: string) {
  const owner = await prisma.user.create({
    data: {
      email: `${slugifyForEmail(kbName)}-${randomBytes(4).toString("hex")}@example.com`,
      passwordHash: "hash",
    },
  });
  const kb = await prisma.knowledgeBase.create({
    data: {
      slug: `${slugifyForEmail(kbName)}-${randomBytes(4).toString("hex")}`,
      name: kbName,
      status: KbStatus.ACTIVE,
      visibility: KbVisibility.PRIVATE,
      members: {
        create: {
          userId: owner.id,
          role: KbRole.OWNER,
        },
      },
    },
  });

  return { kb, owner };
}

async function createIndexedChunkFixture(prisma: PrismaClient, kbName: string) {
  const { kb, owner } = await createKbWithOwner(prisma, kbName);
  const document = await prisma.document.create({
    data: {
      kbId: kb.id,
      name: `${kbName} Document`,
      type: "text/plain",
      status: DocumentStatus.INDEXED,
    },
  });
  const version = await prisma.documentVersion.create({
    data: {
      documentId: document.id,
      storageBucket: "knowledge-base-bucket",
      s3Key: `${kb.slug}/document.txt`,
      contentHash: randomBytes(8).toString("hex"),
      versionNumber: 1,
      status: "INDEXED",
      ingestVersion: 1,
      pipelineVersion: "phase7.v1",
      vectorizationStatus: "DISABLED",
      chunkCount: 0,
      indexedAt: new Date(),
    },
  });

  return { kb, owner, document, version };
}

async function expectDatabaseFailure(
  label: string,
  operation: () => Promise<unknown>,
) {
  try {
    await operation();
  } catch {
    return;
  }

  throw new Error(`Expected database failure for ${label}`);
}

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual === expected) {
    return;
  }

  throw new Error(`${message}: expected ${expected}, got ${actual}`);
}

function slugifyForEmail(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "value"
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
