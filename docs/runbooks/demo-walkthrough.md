# Demo Walkthrough

This walkthrough assumes the full Docker demo stack is running.

## 1. Start the stack

```bash
pnpm install
pnpm run demo:up
pnpm run demo:ps
```

Then verify:

- `http://localhost:3000/api/v1/health/ready`
- `http://localhost:8000/api/v1/health/ready`

Optional:

- set `OPENAI_API_KEY` before boot if you want semantic retrieval and eval answer generation
- run `pnpm run test:demo:smoke` after boot for a scripted verification path

## 2. Seeded accounts

Default local users:

- admin: `demo-admin@example.com` / `DemoPass1234`
- editor: `demo-editor@example.com` / `DemoPass1234`
- viewer: `demo-viewer@example.com` / `DemoPass1234`
- user: `demo-user@example.com` / `DemoPass1234`

## 3. Seeded KBs and fixtures

Knowledge bases:

- `Support Demo KB`
  - preloaded with four demo documents
  - intended for immediate retrieval and citation demos
- `Upload Sandbox KB`
  - starts empty
  - intended for the upload -> queue -> worker indexing flow
- `Restricted Admin KB`
  - admin-only access-control smoke target

Seeded support documents:

- `Worker Recovery Runbook`
- `Escalation Evidence Checklist`
- `Queue Backlog Playbook`
- `Account Reset Playbook`

Seeded eval set:

- `Support Smoke Eval`

## 4. Log in

```bash
curl -X POST http://localhost:3000/api/v1/auth/login ^
  -H "Content-Type: application/json" ^
  -d "{\"email\":\"demo-admin@example.com\",\"password\":\"DemoPass1234\"}"
```

Store the returned `access_token`.

## 5. Discover the seeded KB ids

```bash
curl http://localhost:3000/api/v1/knowledge-bases ^
  -H "Authorization: Bearer <jwt>"
```

Copy the ids for:

- `Support Demo KB`
- `Upload Sandbox KB`

## 6. Wait for the seeded support documents

```bash
curl "http://localhost:3000/api/v1/documents?kbId=<support-kb-id>" ^
  -H "Authorization: Bearer <jwt>"
```

Expected final state:

- four documents listed
- every document `status = INDEXED`
- every latest version `status = INDEXED`
- every latest ingest job `status = COMPLETED`

## 7. Ask grounded questions

Single-source:

```bash
curl -X POST http://localhost:3000/api/v1/chat/ask ^
  -H "Authorization: Bearer <jwt>" ^
  -H "Content-Type: application/json" ^
  -d "{\"kbId\":\"<support-kb-id>\",\"question\":\"How do I reset the worker?\"}"
```

Multi-source:

```bash
curl -X POST http://localhost:3000/api/v1/chat/ask ^
  -H "Authorization: Bearer <jwt>" ^
  -H "Content-Type: application/json" ^
  -d "{\"kbId\":\"<support-kb-id>\",\"question\":\"Before escalating a stuck ingest queue, what should I verify first and what evidence should I collect?\"}"
```

Ambiguous-keyword:

```bash
curl -X POST http://localhost:3000/api/v1/chat/ask ^
  -H "Authorization: Bearer <jwt>" ^
  -H "Content-Type: application/json" ^
  -d "{\"kbId\":\"<support-kb-id>\",\"question\":\"How do I reset a customer account?\"}"
```

Out-of-scope:

```bash
curl -X POST http://localhost:3000/api/v1/chat/ask ^
  -H "Authorization: Bearer <jwt>" ^
  -H "Content-Type: application/json" ^
  -d "{\"kbId\":\"<support-kb-id>\",\"question\":\"What is the vacation policy?\"}"
```

Expected:

- first three questions: `status = grounded`
- first three questions: `citations.length >= 1`
- multi-source question: `citations.length >= 2`
- out-of-scope question: `status = out_of_scope`

## 8. Inspect conversation persistence

```bash
curl http://localhost:3000/api/v1/conversations ^
  -H "Authorization: Bearer <jwt>"
```

```bash
curl http://localhost:3000/api/v1/conversations/<conversation-id> ^
  -H "Authorization: Bearer <jwt>"
```

```bash
curl "http://localhost:3000/api/v1/conversations/<conversation-id>/messages?limit=10" ^
  -H "Authorization: Bearer <jwt>"
```

Assistant messages should include persisted citations.

## 9. Exercise the upload flow in the sandbox KB

Fixture:

- [sample-support-runbook.txt](../demo/sample-support-runbook.txt)

Upload:

```bash
curl -X POST http://localhost:3000/api/v1/documents/upload ^
  -H "Authorization: Bearer <jwt>" ^
  -F "kbId=<sandbox-kb-id>" ^
  -F "name=Support Runbook Upload" ^
  -F "file=@docs/demo/sample-support-runbook.txt;type=text/plain"
```

Poll:

```bash
curl http://localhost:3000/api/v1/documents/<document-id> ^
  -H "Authorization: Bearer <jwt>"
```

Expected state:

- `status = INDEXED`
- `latestVersion.status = INDEXED`
- `latestVersion.chunkCount > 0`
- `latestVersion.latestIngestJob.status = COMPLETED`

## 10. Ops checks

```bash
curl http://localhost:3000/api/v1/ops/jobs/failed ^
  -H "Authorization: Bearer <jwt>"
```

```bash
curl http://localhost:3000/api/v1/ops/metrics ^
  -H "Authorization: Bearer <jwt>"
```

## 11. Eval note

Eval and ops endpoints require `SUPER_ADMIN` or `OPERATOR`. The seeded admin and editor accounts both satisfy that requirement.

Eval runs still require `OPENAI_API_KEY` because answer generation for evals remains provider-backed:

```bash
curl http://localhost:3000/api/v1/evals/sets ^
  -H "Authorization: Bearer <jwt>"
```

```bash
curl -X POST http://localhost:3000/api/v1/evals/runs ^
  -H "Authorization: Bearer <jwt>" ^
  -H "Content-Type: application/json" ^
  -d "{\"evalSetId\":\"<eval-set-id>\"}"
```

## 12. If OpenAI is disabled

- document upload and ingestion still work
- worker indexing still works
- semantic retrieval degrades to lexical-only retrieval
- seeded grounded chat still works through the local extractive fallback
- eval answer generation still returns `503`

## 13. Fastest reviewer path

1. verify API and worker readiness
2. log in as admin
3. list KBs and capture `Support Demo KB` + `Upload Sandbox KB`
4. wait for seeded support documents to become `INDEXED`
5. ask `How do I reset the worker?`
6. inspect the stored conversation
7. upload `sample-support-runbook.txt` to the sandbox KB
8. run `pnpm run test:demo:smoke`
