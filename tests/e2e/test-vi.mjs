import fs from "fs/promises";
import path from "path";

const apiBaseUrl = process.env.RAG_API_BASE_URL ?? "http://localhost:3333/api/v1";
const adminEmail = process.env.DEMO_ADMIN_EMAIL ?? "demo-admin@example.com";
const adminPassword = process.env.DEMO_ADMIN_PASSWORD ?? "DemoPass1234";

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
  const sandboxKb = knowledgeBases.find((kb) => kb.name === "Cơ sở kiến thức Tải lên Thử nghiệm");

  if (!sandboxKb) {
    throw new Error(`Seeded KB not found`);
  }

  const sandboxUploadPath = path.resolve("tests/e2e/test-vi.txt");
  const sandboxUpload = await uploadDocument({
    filePath: sandboxUploadPath,
    kbId: sandboxKb.id,
    name: "Vietnamese Test",
    token,
  });

  console.log("Document uploaded, waiting for indexing...");

  await pollUntil(
    async () => {
      const document = await requestJson(
        `${apiBaseUrl}/documents/${sandboxUpload.id}`,
        {
          headers: authHeaders(token),
        },
      );
      if (document.status === "FAILED") {
        throw new Error(`sandbox upload failed`);
      }
      return {
        done: document.status === "INDEXED",
        value: document,
      };
    },
    120000,
    3000,
    "sandbox upload to reach INDEXED",
  );

  console.log("Indexed successfully. Asking Vietnamese question...");

  const response = await requestJson(`${apiBaseUrl}/chat/ask`, {
    method: "POST",
    headers: authHeaders(token),
    body: {
      kbId: sandboxKb.id,
      question: "Làm thế nào để lưu lại?",
    },
  });

  console.log("Response:", response.status, response.answer);
  if (response.status === "out_of_scope") {
    throw new Error("Still out of scope!");
  }
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
