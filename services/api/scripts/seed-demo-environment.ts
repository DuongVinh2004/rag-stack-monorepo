import {
  EvalCaseStatus,
  EvalSetStatus,
  KbRole,
  KbStatus,
  KbVisibility,
  PrismaClient,
  SystemRole,
  UserStatus,
} from "@prisma/client";
import * as bcrypt from "bcryptjs";
import * as crypto from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import { Queue } from "bullmq";
import { StorageService } from "../src/common/storage/storage.service";
import { getRedisHost, getRedisPort } from "../src/config/runtime-config";
import {
  INGEST_JOB_NAME,
  INGEST_PIPELINE_VERSION,
  INGEST_QUEUE_NAME,
} from "../src/documents/documents.constants";
import {
  buildIngestQueueOptions,
  buildIngestQueuePayload,
  getConfiguredIngestMaxAttempts,
  getInitialVectorizationStatus,
} from "../src/documents/ingest-job.helpers";
import { slugifyKnowledgeBaseName } from "../src/knowledge-bases/kb-slug";

const DEFAULT_PASSWORD = "DemoPass1234";
const DEFAULT_KB_NAME = "Cơ sở kiến thức Hỗ trợ";
const DEFAULT_KB_DESCRIPTION =
  "Cơ sở kiến thức dành cho người đánh giá với các nội dung hỗ trợ được tải sẵn để kiểm tra tìm kiếm, trích dẫn và trò chuyện.";
const DEFAULT_EVAL_SET_NAME = "Support Smoke Eval";
const DEMO_CORRELATION_ID = "seed-demo-environment";
const TEXT_MIME_TYPE = "text/plain";
type DemoAccount = {
  email: string;
  password: string;
  kbRoles: Record<string, KbRole>;
  roleNames: SystemRole[];
};

type DemoKbSpec = {
  id: string;
  slug: string;
  name: string;
  description: string;
  visibility: KbVisibility;
  status: KbStatus;
};

type DemoDocumentSpec = {
  id: string;
  versionId: string;
  ingestJobId: string;
  kbKey: "support";
  name: string;
  relativePath: string;
  mimeType: string;
  scenario: "single_source" | "multi_source" | "ambiguous_keyword";
};

const DEMO_KB_IDS = {
  support: "8d63f4d0-b706-4d7a-bb8e-42c616aa1111",
  sandbox: "8d63f4d0-b706-4d7a-bb8e-42c616aa2222",
  restricted: "8d63f4d0-b706-4d7a-bb8e-42c616aa3333",
} as const;

const DEMO_DOCUMENTS: DemoDocumentSpec[] = [
  {
    id: "21bd8393-f0ae-46c0-a7ae-6b1ef84f1001",
    versionId: "21bd8393-f0ae-46c0-a7ae-6b1ef84f2001",
    ingestJobId: "21bd8393-f0ae-46c0-a7ae-6b1ef84f3001",
    kbKey: "support",
    name: "Worker Recovery Runbook",
    relativePath: "../../../docs/demo/worker-recovery-runbook.txt",
    mimeType: TEXT_MIME_TYPE,
    scenario: "single_source",
  },
  {
    id: "21bd8393-f0ae-46c0-a7ae-6b1ef84f1002",
    versionId: "21bd8393-f0ae-46c0-a7ae-6b1ef84f2002",
    ingestJobId: "21bd8393-f0ae-46c0-a7ae-6b1ef84f3002",
    kbKey: "support",
    name: "Escalation Evidence Checklist",
    relativePath: "../../../docs/demo/escalation-evidence-checklist.txt",
    mimeType: TEXT_MIME_TYPE,
    scenario: "multi_source",
  },
  {
    id: "21bd8393-f0ae-46c0-a7ae-6b1ef84f1003",
    versionId: "21bd8393-f0ae-46c0-a7ae-6b1ef84f2003",
    ingestJobId: "21bd8393-f0ae-46c0-a7ae-6b1ef84f3003",
    kbKey: "support",
    name: "Queue Backlog Playbook",
    relativePath: "../../../docs/demo/queue-backlog-playbook.txt",
    mimeType: TEXT_MIME_TYPE,
    scenario: "multi_source",
  },
  {
    id: "21bd8393-f0ae-46c0-a7ae-6b1ef84f1004",
    versionId: "21bd8393-f0ae-46c0-a7ae-6b1ef84f2004",
    ingestJobId: "21bd8393-f0ae-46c0-a7ae-6b1ef84f3004",
    kbKey: "support",
    name: "Account Reset Playbook",
    relativePath: "../../../docs/demo/account-reset-playbook.txt",
    mimeType: TEXT_MIME_TYPE,
    scenario: "ambiguous_keyword",
  },
];

async function main() {
  const prisma = new PrismaClient();
  const storage = new StorageService();
  const queue = new Queue(INGEST_QUEUE_NAME, {
    connection: {
      host: getRedisHost(),
      port: getRedisPort(),
    },
  });
  const accounts = buildAccounts();
  const supportKbName = readValue(
    "--kbName",
    process.env.DEMO_KB_NAME ?? DEFAULT_KB_NAME,
  ).trim();
  const supportKbDescription = readValue(
    "--kbDescription",
    process.env.DEMO_KB_DESCRIPTION ?? DEFAULT_KB_DESCRIPTION,
  ).trim();
  const supportKbSlug = readValue(
    "--kbSlug",
    process.env.DEMO_KB_SLUG ?? slugifyKnowledgeBaseName(supportKbName),
  ).trim();
  const supportKbVisibility = parseVisibility(
    readValue(
      "--kbVisibility",
      process.env.DEMO_KB_VISIBILITY ?? KbVisibility.PRIVATE,
    ).trim(),
  );
  const evalSetName = readValue(
    "--evalSetName",
    process.env.DEMO_EVAL_SET_NAME ?? DEFAULT_EVAL_SET_NAME,
  ).trim();
  const sampleKbSpecs = buildKnowledgeBases({
    supportKbName,
    supportKbDescription,
    supportKbSlug,
    supportKbVisibility,
  });

  try {
    await storage.checkBucket(process.env.S3_BUCKET ?? "knowledge-base-bucket");

    const roleIds = await ensureRoles(prisma, Object.values(SystemRole));
    const users = await Promise.all(
      accounts.map((account) => upsertUser(prisma, account)),
    );

    await Promise.all(
      users.flatMap(({ userId, roleNames }) =>
        roleNames.map((roleName) =>
          prisma.userRole.upsert({
            where: {
              userId_roleId: {
                userId,
                roleId: roleIds[roleName],
              },
            },
            update: {},
            create: {
              userId,
              roleId: roleIds[roleName],
            },
          }),
        ),
      ),
    );

    const createdKnowledgeBases = await Promise.all(
      sampleKbSpecs.map((kb) => upsertKnowledgeBase(prisma, kb)),
    );
    const kbByKey = {
      support: createdKnowledgeBases[0],
      sandbox: createdKnowledgeBases[1],
      restricted: createdKnowledgeBases[2],
    } as const;

    await Promise.all(
      users.flatMap(({ userId, memberships }) =>
        Object.entries(memberships).map(([kbKey, role]) =>
          prisma.kbMember.upsert({
            where: {
              kbId_userId: {
                kbId: kbByKey[kbKey as keyof typeof kbByKey].id,
                userId,
              },
            },
            update: {
              role,
            },
            create: {
              kbId: kbByKey[kbKey as keyof typeof kbByKey].id,
              userId,
              role,
            },
          }),
        ),
      ),
    );

    const sampleDocuments = await Promise.all(
      DEMO_DOCUMENTS.map((document) =>
        ensureSeededDocument({
          prisma,
          queue,
          storage,
          kb: kbByKey[document.kbKey],
          document,
        }),
      ),
    );

    const evalSet = await upsertEvalFixtures({
      evalSetName,
      kb: kbByKey.support,
      prisma,
      documentIds: {
        workerRecovery: DEMO_DOCUMENTS[0].id,
        accountReset: DEMO_DOCUMENTS[3].id,
      },
    });

    console.log(
      JSON.stringify(
        {
          event: "demo_environment_seeded",
          accounts: users.map((entry) => ({
            email: entry.email,
            memberships: entry.memberships,
            systemRoles: entry.roleNames,
          })),
          knowledgeBases: createdKnowledgeBases.map((kb) => ({
            id: kb.id,
            name: kb.name,
            slug: kb.slug,
            visibility: kb.visibility,
          })),
          documents: sampleDocuments.map((document) => ({
            id: document.id,
            name: document.name,
            kbId: document.kbId,
            status: document.status,
            latestVersionStatus: document.latestVersionStatus,
          })),
          evalSetId: evalSet.id,
          evalSetName: evalSet.name,
          sampleQuestions: [
            "Làm thế nào để khởi động lại worker?",
            "Trước khi báo cáo hàng chờ bị kẹt, tôi nên kiểm tra gì và thu thập bằng chứng nào?",
            "Làm thế nào để đặt lại tài khoản khách hàng?",
            "Chính sách nghỉ phép là gì?",
          ],
        },
        null,
        2,
      ),
    );
  } finally {
    await queue.close();
    await prisma.$disconnect();
  }
}

async function ensureRoles(prisma: PrismaClient, names: SystemRole[]) {
  const roleIds = {} as Record<SystemRole, string>;

  for (const name of names) {
    const role = await prisma.role.upsert({
      where: { name },
      update: {},
      create: { name },
    });
    roleIds[name] = role.id;
  }

  return roleIds;
}

function buildAccounts(): DemoAccount[] {
  return [
    {
      email: readValue(
        "--adminEmail",
        process.env.DEMO_ADMIN_EMAIL ?? "demo-admin@example.com",
      )
        .trim()
        .toLowerCase(),
      password: readValue(
        "--adminPassword",
        process.env.DEMO_ADMIN_PASSWORD ?? DEFAULT_PASSWORD,
      ),
      kbRoles: {
        support: KbRole.OWNER,
        sandbox: KbRole.OWNER,
        restricted: KbRole.OWNER,
      },
      roleNames: [SystemRole.SUPER_ADMIN, SystemRole.USER],
    },
    {
      email: readValue(
        "--editorEmail",
        process.env.DEMO_EDITOR_EMAIL ?? "demo-editor@example.com",
      )
        .trim()
        .toLowerCase(),
      password: readValue(
        "--editorPassword",
        process.env.DEMO_EDITOR_PASSWORD ?? DEFAULT_PASSWORD,
      ),
      kbRoles: {
        support: KbRole.EDITOR,
        sandbox: KbRole.EDITOR,
      },
      roleNames: [SystemRole.OPERATOR, SystemRole.USER],
    },
    {
      email: readValue(
        "--viewerEmail",
        process.env.DEMO_VIEWER_EMAIL ?? "demo-viewer@example.com",
      )
        .trim()
        .toLowerCase(),
      password: readValue(
        "--viewerPassword",
        process.env.DEMO_VIEWER_PASSWORD ?? DEFAULT_PASSWORD,
      ),
      kbRoles: {
        support: KbRole.VIEWER,
        sandbox: KbRole.VIEWER,
      },
      roleNames: [SystemRole.USER],
    },
    {
      email: readValue(
        "--userEmail",
        process.env.DEMO_USER_EMAIL ?? "demo-user@example.com",
      )
        .trim()
        .toLowerCase(),
      password: readValue(
        "--userPassword",
        process.env.DEMO_USER_PASSWORD ?? DEFAULT_PASSWORD,
      ),
      kbRoles: {
        support: KbRole.VIEWER,
      },
      roleNames: [SystemRole.USER],
    },
  ].map((account) => {
    if (!/^(?=.*[A-Za-z])(?=.*\d).{10,128}$/.test(account.password.trim())) {
      throw new Error(
        `Password for ${account.email} must be 10-128 characters and contain at least one letter and one number.`,
      );
    }

    return {
      ...account,
      password: account.password.trim(),
    };
  });
}

function buildKnowledgeBases(params: {
  supportKbName: string;
  supportKbDescription: string;
  supportKbSlug: string;
  supportKbVisibility: KbVisibility;
}): DemoKbSpec[] {
  return [
    {
      id: DEMO_KB_IDS.support,
      slug: params.supportKbSlug,
      name: params.supportKbName,
      description: params.supportKbDescription,
      visibility: params.supportKbVisibility,
      status: KbStatus.ACTIVE,
    },
    {
      id: DEMO_KB_IDS.sandbox,
      slug: "upload-sandbox-kb",
      name: "Cơ sở kiến thức Tải lên Thử nghiệm",
      description:
        "Cơ sở kiến thức trống dùng để thử nghiệm quy trình Tải lên -> Hàng chờ -> Lập chỉ mục.",
      visibility: KbVisibility.PRIVATE,
      status: KbStatus.ACTIVE,
    },
    {
      id: DEMO_KB_IDS.restricted,
      slug: "restricted-admin-kb",
      name: "Cơ sở kiến thức Quản trị Giới hạn",
      description:
        "Cơ sở kiến thức chỉ dành cho Admin để kiểm tra kiểm soát truy cập.",
      visibility: KbVisibility.PRIVATE,
      status: KbStatus.ACTIVE,
    },
  ];
}

async function upsertUser(prisma: PrismaClient, account: DemoAccount) {
  const passwordHash = await bcrypt.hash(account.password, 12);
  const user = await prisma.user.upsert({
    where: { email: account.email },
    update: {
      passwordHash,
      status: UserStatus.ACTIVE,
    },
    create: {
      email: account.email,
      passwordHash,
      status: UserStatus.ACTIVE,
    },
  });

  return {
    userId: user.id,
    email: account.email,
    memberships: account.kbRoles,
    roleNames: account.roleNames,
  };
}

async function upsertKnowledgeBase(prisma: PrismaClient, kb: DemoKbSpec) {
  return prisma.knowledgeBase.upsert({
    where: { slug: kb.slug },
    create: {
      id: kb.id,
      slug: kb.slug,
      name: kb.name,
      description: kb.description,
      status: kb.status,
      visibility: kb.visibility,
    },
    update: {
      name: kb.name,
      description: kb.description,
      status: kb.status,
      archivedAt: null,
      visibility: kb.visibility,
    },
  });
}

async function ensureSeededDocument(params: {
  prisma: PrismaClient;
  queue: Queue;
  storage: StorageService;
  kb: { id: string; slug: string; name: string };
  document: DemoDocumentSpec;
}) {
  const absolutePath = path.resolve(__dirname, params.document.relativePath);
  const fileBuffer = await fs.readFile(absolutePath);
  const contentHash = crypto
    .createHash("sha256")
    .update(fileBuffer)
    .digest("hex");
  const storageBucket = process.env.S3_BUCKET ?? "knowledge-base-bucket";
  const storageKey = `${params.kb.slug}/seed/${path.basename(absolutePath)}`;
  const vectorizationStatus = getInitialVectorizationStatus(
    Boolean(process.env.OPENAI_API_KEY?.trim()) &&
      process.env.OPENAI_EMBEDDINGS_ENABLED !== "false",
  );
  const maxAttempts = getConfiguredIngestMaxAttempts(
    process.env.INGEST_MAX_ATTEMPTS,
  );

  await params.storage.uploadFile(
    storageBucket,
    storageKey,
    fileBuffer,
    params.document.mimeType,
  );

  const existingDocument = await params.prisma.document.findUnique({
    where: { id: params.document.id },
    include: {
      versions: {
        where: { id: params.document.versionId },
        include: {
          ingestJobs: {
            where: { id: params.document.ingestJobId },
          },
        },
      },
    },
  });
  const existingVersion = existingDocument?.versions[0] ?? null;
  const existingJob = existingVersion?.ingestJobs[0] ?? null;
  const alreadyIndexed =
    existingDocument?.status === "INDEXED" &&
    existingVersion?.status === "INDEXED" &&
    existingVersion.contentHash === contentHash;
  const alreadyQueued =
    existingVersion?.contentHash === contentHash &&
    (existingJob?.status === "WAITING" || existingJob?.status === "ACTIVE");

  if (alreadyIndexed) {
    return {
      id: existingDocument.id,
      kbId: existingDocument.kbId,
      name: existingDocument.name,
      status: existingDocument.status,
      latestVersionStatus: existingVersion?.status ?? "INDEXED",
    };
  }

  if (alreadyQueued) {
    return {
      id: existingDocument?.id ?? params.document.id,
      kbId: existingDocument?.kbId ?? params.kb.id,
      name: existingDocument?.name ?? params.document.name,
      status: existingDocument?.status ?? "QUEUED",
      latestVersionStatus: existingVersion?.status ?? "QUEUED",
    };
  }

  const nextIngestVersion = Math.max(existingVersion?.ingestVersion ?? 0, 0) + 1;

  await params.prisma.$transaction(async (tx) => {
    if (!existingDocument) {
      await tx.document.create({
        data: {
          id: params.document.id,
          kbId: params.kb.id,
          name: params.document.name,
          type: params.document.mimeType,
          status: "QUEUED",
        },
      });
    } else {
      await tx.document.update({
        where: { id: existingDocument.id },
        data: {
          kbId: params.kb.id,
          name: params.document.name,
          type: params.document.mimeType,
          status: "QUEUED",
          indexedAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
        },
      });
    }

    if (!existingVersion) {
      await tx.documentVersion.create({
        data: {
          id: params.document.versionId,
          documentId: params.document.id,
          storageBucket,
          s3Key: storageKey,
          contentHash,
          versionNumber: 1,
          status: "QUEUED",
          ingestVersion: 1,
          pipelineVersion: INGEST_PIPELINE_VERSION,
          vectorizationStatus,
        },
      });
    } else {
      await tx.documentVersion.update({
        where: { id: existingVersion.id },
        data: {
          storageBucket,
          s3Key: storageKey,
          contentHash,
          status: "QUEUED",
          ingestVersion: nextIngestVersion,
          pipelineVersion: INGEST_PIPELINE_VERSION,
          vectorizationStatus,
          chunkCount: 0,
          indexedAt: null,
          startedAt: null,
          finishedAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
        },
      });
    }

    if (!existingJob) {
      await tx.ingestJob.create({
        data: {
          id: params.document.ingestJobId,
          documentVersionId: params.document.versionId,
          status: "WAITING",
          correlationId: DEMO_CORRELATION_ID,
          maxAttempts,
        },
      });
    } else {
      await tx.ingestJob.update({
        where: { id: existingJob.id },
        data: {
          status: "WAITING",
          errorCode: null,
          errorMessage: null,
          retryable: true,
          attempts: 0,
          maxAttempts,
          correlationId: DEMO_CORRELATION_ID,
          startedAt: null,
          finishedAt: null,
        },
      });
    }
  });

  await params.queue.add(
    INGEST_JOB_NAME,
    buildIngestQueuePayload({
      correlationId: DEMO_CORRELATION_ID,
      document: {
        id: params.document.id,
        kbId: params.kb.id,
        name: params.document.name,
        type: params.document.mimeType,
      },
      version: {
        id: params.document.versionId,
        ingestVersion: existingVersion ? nextIngestVersion : 1,
        pipelineVersion: INGEST_PIPELINE_VERSION,
        storageBucket,
        s3Key: storageKey,
      },
      ingestJob: {
        id: params.document.ingestJobId,
        maxAttempts,
      },
    }),
    buildIngestQueueOptions(params.document.ingestJobId, maxAttempts),
  );

  return {
    id: params.document.id,
    kbId: params.kb.id,
    name: params.document.name,
    status: "QUEUED",
    latestVersionStatus: "QUEUED",
  };
}

async function upsertEvalFixtures(params: {
  prisma: PrismaClient;
  kb: { id: string; name: string };
  evalSetName: string;
  documentIds: {
    workerRecovery: string;
    accountReset: string;
  };
}) {
  const evalSet = await params.prisma.evalSet.upsert({
    where: {
      kbId_name: {
        kbId: params.kb.id,
        name: params.evalSetName,
      },
    },
    update: {
      description:
        "Reviewer-facing eval set for the seeded support fixtures.",
      status: EvalSetStatus.ACTIVE,
    },
    create: {
      kbId: params.kb.id,
      name: params.evalSetName,
      description:
        "Reviewer-facing eval set for the seeded support fixtures.",
      status: EvalSetStatus.ACTIVE,
    },
  });

  const cases = [
    {
      question: "How do I reset the worker?",
      expectedAnswer:
        "Restart the worker process before retrying the failed job.",
      expectedSourceDocumentId: params.documentIds.workerRecovery,
      expectedSourceHint: "Resetting the worker",
      category: "single_source_factual",
    },
    {
      question:
        "Before escalating a stuck ingest queue, what should I verify first and what evidence should I collect?",
      expectedAnswer:
        "Check Redis health and confirm the worker is consuming from ingest_jobs, then gather the ingest job id, document id, document version id, correlation id, and worker logs.",
      expectedSourceDocumentId: null,
      expectedSourceHint:
        "Redis health, worker consumption, ingest job id, document id, document version id, correlation id, and worker logs",
      category: "multi_source_synthesis",
    },
    {
      question: "How do I reset a customer account?",
      expectedAnswer:
        "Clear the active session, issue a password reset link, and record the support ticket id.",
      expectedSourceDocumentId: params.documentIds.accountReset,
      expectedSourceHint: "Account reset",
      category: "ambiguous_keyword_overlap",
    },
    {
      question: "What is the vacation policy?",
      expectedAnswer: null,
      expectedSourceDocumentId: null,
      expectedSourceHint: null,
      category: "out_of_scope",
    },
  ];

  for (const evalCase of cases) {
    const existingCase = await params.prisma.evalCase.findFirst({
      where: {
        evalSetId: evalSet.id,
        question: evalCase.question,
      },
      select: { id: true },
    });

    if (!existingCase) {
      await params.prisma.evalCase.create({
        data: {
          evalSetId: evalSet.id,
          question: evalCase.question,
          expectedAnswer: evalCase.expectedAnswer,
          expectedSourceDocumentId: evalCase.expectedSourceDocumentId,
          expectedSourceHint: evalCase.expectedSourceHint,
          category: evalCase.category,
          difficulty: "medium",
          status: EvalCaseStatus.ACTIVE,
        },
      });
      continue;
    }

    await params.prisma.evalCase.update({
      where: { id: existingCase.id },
      data: {
        expectedAnswer: evalCase.expectedAnswer,
        expectedSourceDocumentId: evalCase.expectedSourceDocumentId,
        expectedSourceHint: evalCase.expectedSourceHint,
        category: evalCase.category,
        status: EvalCaseStatus.ACTIVE,
      },
    });
  }

  return evalSet;
}

function parseVisibility(raw: string) {
  const normalized = raw.trim().toUpperCase();
  if (normalized === KbVisibility.PRIVATE) {
    return KbVisibility.PRIVATE;
  }
  if (normalized === KbVisibility.INTERNAL) {
    return KbVisibility.INTERNAL;
  }
  if (normalized === KbVisibility.PUBLIC) {
    return KbVisibility.PUBLIC;
  }
  throw new Error(`Unsupported KB visibility: ${raw}`);
}

function readValue(flag: string, fallback: string) {
  const index = process.argv.findIndex((value) => value === flag);
  if (index >= 0 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }
  return fallback;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
