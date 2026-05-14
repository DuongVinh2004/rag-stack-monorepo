import fs from "fs/promises";
import path from "path";

const apiBaseUrl = process.env.RAG_API_BASE_URL ?? "http://localhost:3000/api/v1";
const adminEmail = process.env.DEMO_ADMIN_EMAIL ?? "demo-admin@example.com";
const adminPassword = process.env.DEMO_ADMIN_PASSWORD ?? "DemoPass1234";
const supportKbName = process.env.DEMO_KB_NAME ?? "Support Demo KB";
const sandboxKbName = process.env.RAG_SANDBOX_KB_NAME ?? "Upload Sandbox KB";
const indexedTimeoutMs = Number.parseInt(
  process.env.RAG_DEMO_INDEX_TIMEOUT_MS ?? "120000",
  10,
);
const pollIntervalMs = Number.parseInt(
  process.env.RAG_DEMO_POLL_INTERVAL_MS ?? "3000",
  10,
);

async function main() {
  const login = await requestJson(`${apiBaseUrl}/auth/login`, {
    method: "POST",
    body: {
      email: adminEmail,
      password: adminPassword,
    },
  });
  const token = login.access_token;
  if (!token) {
    throw new Error("Login response did not include access_token");
  }

  const knowledgeBases = await requestJson(`${apiBaseUrl}/knowledge-bases`, {
    headers: authHeaders(token),
  });
  const supportKb = knowledgeBases.find((kb) => kb.name === supportKbName);
  const sandboxKb = knowledgeBases.find((kb) => kb.name === sandboxKbName);

  if (!supportKb) {
    throw new Error(`Seeded KB not found: ${supportKbName}`);
  }
  if (!sandboxKb) {
    throw new Error(`Seeded KB not found: ${sandboxKbName}`);
  }

  const seededDocuments = await pollUntil(
    async () => {
      const documents = await requestJson(
        `${apiBaseUrl}/documents?kbId=${encodeURIComponent(supportKb.id)}`,
        { headers: authHeaders(token) },
      );
      const allIndexed =
        documents.length >= 4 &&
        documents.every((document) => document.status === "INDEXED");

      return {
        done: allIndexed,
        value: documents,
      };
    },
    indexedTimeoutMs,
    pollIntervalMs,
    "seeded documents to reach INDEXED",
  );

  const singleSource = await requestJson(`${apiBaseUrl}/chat/ask`, {
    method: "POST",
    headers: authHeaders(token),
    body: {
      kbId: supportKb.id,
      question: "How do I reset the worker?",
    },
  });
  assert(singleSource.status === "grounded", "single-source answer should be grounded");
  assert(
    Array.isArray(singleSource.citations) && singleSource.citations.length >= 1,
    "single-source answer should include citations",
  );

  const multiSource = await requestJson(`${apiBaseUrl}/chat/ask`, {
    method: "POST",
    headers: authHeaders(token),
    body: {
      conversationId: singleSource.conversationId,
      question:
        "Before escalating a stuck ingest queue, what should I verify first and what evidence should I collect?",
    },
  });
  assert(multiSource.status === "grounded", "multi-source answer should be grounded");
  assert(
    Array.isArray(multiSource.citations) && multiSource.citations.length >= 2,
    "multi-source answer should include at least two citations",
  );

  const outOfScope = await requestJson(`${apiBaseUrl}/chat/ask`, {
    method: "POST",
    headers: authHeaders(token),
    body: {
      kbId: supportKb.id,
      question: "What is the vacation policy?",
    },
  });
  assert(outOfScope.status === "out_of_scope", "out-of-scope answer should refuse");

  const conversation = await requestJson(
    `${apiBaseUrl}/conversations/${singleSource.conversationId}`,
    {
      headers: authHeaders(token),
    },
  );
  assert(
    Array.isArray(conversation.messages) && conversation.messages.length >= 4,
    "conversation detail should contain persisted messages",
  );

  const sandboxUploadPath = path.resolve("docs/demo/sample-support-runbook.txt");
  const sandboxUpload = await uploadDocument({
    filePath: sandboxUploadPath,
    kbId: sandboxKb.id,
    name: "Sandbox Upload Runbook",
    token,
  });
  assert(sandboxUpload.status === "QUEUED", "uploaded sandbox document should queue ingestion");

  const indexedUpload = await pollUntil(
    async () => {
      const document = await requestJson(
        `${apiBaseUrl}/documents/${sandboxUpload.id}`,
        {
          headers: authHeaders(token),
        },
      );
      if (document.status === "FAILED") {
        throw new Error(
          `sandbox upload failed: ${document.lastErrorCode ?? "UNKNOWN"} ${document.lastErrorMessage ?? ""}`.trim(),
        );
      }
      return {
        done: document.status === "INDEXED",
        value: document,
      };
    },
    indexedTimeoutMs,
    pollIntervalMs,
    "sandbox upload to reach INDEXED",
  );

  console.log(
    JSON.stringify(
      {
        apiBaseUrl,
        seededSupportKbId: supportKb.id,
        sandboxKbId: sandboxKb.id,
        seededDocuments: seededDocuments.map((document) => ({
          id: document.id,
          name: document.name,
          status: document.status,
        })),
        conversationId: singleSource.conversationId,
        sandboxUploadId: indexedUpload.id,
        checks: {
          login: "ok",
          seededDocsIndexed: "ok",
          groundedChat: "ok",
          conversationPersistence: "ok",
          uploadLifecycle: "ok",
        },
      },
      null,
      2,
    ),
  );
}

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function requestJson(url, options = {}) {
  const init = { ...options };
  if (init.body && typeof init.body !== "string") {
    init.headers = {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    };
    init.body = JSON.stringify(init.body);
  }

  const response = await fetch(url, init);
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} for ${url}: ${JSON.stringify(json)}`,
    );
  }

  return json;
}

async function uploadDocument(params) {
  const fileBuffer = await fs.readFile(params.filePath);
  const form = new FormData();
  form.set("kbId", params.kbId);
  form.set("name", params.name);
  form.set(
    "file",
    new Blob([fileBuffer], { type: "text/plain" }),
    path.basename(params.filePath),
  );

  const response = await fetch(`${apiBaseUrl}/documents/upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.token}`,
    },
    body: form,
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(
      `sandbox upload failed with HTTP ${response.status}: ${JSON.stringify(json)}`,
    );
  }

  return json;
}

async function pollUntil(check, timeoutMs, intervalMs, description) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    const result = await check();
    if (result.done) {
      return result.value;
    }
    await sleep(intervalMs);
  }

  throw new Error(`Timed out waiting for ${description}`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
