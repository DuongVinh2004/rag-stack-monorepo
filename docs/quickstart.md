# Quickstart

Goal: go from zero to one grounded, citation-backed answer in under 15 minutes.

Basic grounded chat now works with the seeded fixtures even if `OPENAI_API_KEY` is blank. OpenAI still improves semantic retrieval and is still required for eval answer generation.

## 1. Boot

```bash
pnpm install
pnpm run demo:up
pnpm run demo:ps
```

Confirm:

- `GET http://localhost:3000/api/v1/health/ready` -> `200`
- `GET http://localhost:8000/api/v1/health/ready` -> `200`

## 2. Log in

```bash
curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"demo-admin@example.com","password":"DemoPass1234"}'
```

Copy `access_token` from the JSON response.

## 3. Resolve the seeded KBs

```bash
curl -s http://localhost:3000/api/v1/knowledge-bases \
  -H "Authorization: Bearer <jwt>"
```

Look for:

- `Support Demo KB`: preloaded with seeded documents for immediate chat
- `Upload Sandbox KB`: empty KB for the upload demo path

## 4. Wait for the seeded support documents

```bash
curl -s "http://localhost:3000/api/v1/documents?kbId=<support-kb-id>" \
  -H "Authorization: Bearer <jwt>"
```

Wait until all seeded documents show `status = INDEXED`.

## 5. Ask grounded questions immediately

Single-source:

```bash
curl -s -X POST http://localhost:3000/api/v1/chat/ask \
  -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{"kbId":"<support-kb-id>","question":"How do I reset the worker?"}'
```

Multi-source:

```bash
curl -s -X POST http://localhost:3000/api/v1/chat/ask \
  -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{"kbId":"<support-kb-id>","question":"Before escalating a stuck ingest queue, what should I verify first and what evidence should I collect?"}'
```

Out-of-scope:

```bash
curl -s -X POST http://localhost:3000/api/v1/chat/ask \
  -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{"kbId":"<support-kb-id>","question":"What is the vacation policy?"}'
```

Expected:

- first two answers: `status = grounded` with non-empty `citations`
- out-of-scope answer: `status = out_of_scope` with `citations = []`

## 6. Inspect the persisted conversation

```bash
curl -s http://localhost:3000/api/v1/conversations \
  -H "Authorization: Bearer <jwt>"
```

```bash
curl -s http://localhost:3000/api/v1/conversations/<conversation-id> \
  -H "Authorization: Bearer <jwt>"
```

## 7. Exercise the upload path in the sandbox KB

```bash
curl -s -X POST http://localhost:3000/api/v1/documents/upload \
  -H "Authorization: Bearer <jwt>" \
  -F "kbId=<sandbox-kb-id>" \
  -F "name=Support Runbook Upload" \
  -F "file=@docs/demo/sample-support-runbook.txt;type=text/plain"
```

Then poll:

```bash
curl -s http://localhost:3000/api/v1/documents/<document-id> \
  -H "Authorization: Bearer <jwt>"
```

## 8. Run the smoke verifier

```bash
pnpm run test:demo:smoke
```

This hits the live HTTP stack and verifies login, seeded KB discovery, seeded document indexing, grounded chat, conversation persistence, upload, and worker-driven indexing.

## Full walkthrough

See [demo-walkthrough.md](./runbooks/demo-walkthrough.md) for the fuller operator path, seeded fixtures, sample questions, and eval notes.
