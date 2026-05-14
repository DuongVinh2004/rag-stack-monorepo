# Access Control Design

## Role model

### Global roles

- `SUPER_ADMIN`
  - full backend override
  - can access all KBs, documents, conversations, evals, and ops workflows
- `OPERATOR`
  - global access to eval and ops domains only
  - does not grant KB/document/chat access by itself
- `USER`
  - baseline authenticated account with no global override
- `SYSTEM`
  - reserved for internal automation and should not be assigned to human users casually

### KB-local roles

- `OWNER`
  - full KB administration
  - can manage membership, documents, and KB settings
- `EDITOR`
  - can update the KB and manage documents inside that KB
- `VIEWER`
  - read-only KB access, retrieval access, and grounded chat access

## Precedence rules

1. `SUPER_ADMIN` overrides KB membership checks globally.
2. `OPERATOR` is only honored in eval and ops services.
3. For normal KB-scoped work, authorization is membership-based only.
4. KB `visibility` is descriptive/discovery metadata, not a data-access override.
5. Conversation reads require both conversation ownership and current KB membership, unless the caller is `SUPER_ADMIN`.

## Permission matrix

| Action | Allowed roles |
| --- | --- |
| `login` | credential owner |
| `refresh` | refresh-token owner with an active session |
| `logout` | authenticated session owner |
| `create KB` | any authenticated user; creator becomes `OWNER` |
| `list KBs` | `SUPER_ADMIN`, or KB members (`OWNER`/`EDITOR`/`VIEWER`) for their own KBs |
| `read KB` | `SUPER_ADMIN`, or KB members (`OWNER`/`EDITOR`/`VIEWER`) |
| `update KB` | `SUPER_ADMIN`, `OWNER`, `EDITOR` |
| `delete KB` | `SUPER_ADMIN`, `OWNER` |
| `add member` | `SUPER_ADMIN`, `OWNER` |
| `change member role` | `SUPER_ADMIN`, `OWNER` |
| `remove member` | `SUPER_ADMIN`, `OWNER` |
| `upload document` | `SUPER_ADMIN`, `OWNER`, `EDITOR` |
| `list documents` | `SUPER_ADMIN`, `OWNER`, `EDITOR`, `VIEWER` |
| `read document` | `SUPER_ADMIN`, `OWNER`, `EDITOR`, `VIEWER` |
| `reindex document` | `SUPER_ADMIN`, `OWNER`, `EDITOR` |
| `ask question` | `SUPER_ADMIN`, `OWNER`, `EDITOR`, `VIEWER` |
| `read conversation` | `SUPER_ADMIN`, or the conversation owner if they still belong to the KB |
| `list conversations` | `SUPER_ADMIN`, or the conversation owner for conversations in KBs they still belong to |
| `run eval` | `SUPER_ADMIN`, `OPERATOR` |
| `list failed jobs` | `SUPER_ADMIN`, `OPERATOR` |
| `retry failed job` | `SUPER_ADMIN`, `OPERATOR` |

## Enforcement layers

### Controller level

- `JwtAuthGuard` protects all authenticated API routes.
- `RolesGuard` protects `evals` and `ops` controllers with `SUPER_ADMIN` / `OPERATOR`.
- `POST /auth/logout` is authenticated.
- `POST /auth/refresh` is public at the controller layer, but the refresh token is verified in the service.

### Service level

- `AuthorizationService` centralizes:
  - global-role detection
  - KB-scoped `where` builders
  - KB role assertions
  - document scoped reads
  - conversation scoped reads
  - ops/eval role assertions
- KB, document, chat, conversation, eval, and ops services all call service-level authorization helpers before sensitive work.
- Internal service calls cannot bypass authorization because the services themselves enforce scope again.

### Repository and query level

- KB listing uses `KnowledgeBase.findMany(where: buildKnowledgeBaseReadWhere(user))`.
- Document detail and document listing use `Document.findFirst/findMany` with scoped `where` clauses.
- Retrieval SQL hard-filters on:
  - `dc."kbId" = $kbId`
  - `admin OR km."userId" IS NOT NULL`
- Conversation lookup uses `Conversation.findFirst` with:
  - `userId = currentUser`
  - `kb.members.some(userId = currentUser)`
  - or admin override
- Citation persistence validates every cited `chunkId` against the conversation KB in the same transaction before insert.
- Eval and ops services assert `SUPER_ADMIN` / `OPERATOR` before running queries.

## Privacy-preserving failure policy

### `401 Unauthorized`

- missing or invalid access token
- invalid or revoked refresh token

### `404 Not Found`

Used when revealing existence would leak information:

- KB read outside scope
- document read outside scope
- document reindex for an inaccessible document
- conversation read outside scope
- asking a question against an inaccessible KB
- editor attempting to act on a different KB they are not a member of

### `403 Forbidden`

Used when the caller is already in scope but lacks the required role:

- viewer trying to upload or reindex
- editor trying to manage KB membership
- normal user calling eval or ops services
- last-owner removal/demotion attempts

## Audit logging

Sensitive actions write audit rows with:

- `actorId`
- `action`
- `entityType`
- `entityId`
- `kbId` when the action is KB-scoped
- sanitized metadata

Sanitization rules:

- redact obvious secret/token/password/content keys
- truncate long strings
- cap object depth and array length

## Known limitations

- Authorization is still application-enforced; PostgreSQL row-level security is not enabled yet.
- `OPERATOR` is global for eval/ops domains; there is no per-KB operator scope yet.
- Logout currently revokes all refresh sessions for the user, not a single selected device/session.
- There is no ABAC policy layer for document tags, departments, or tenant attributes.

## Future work

- database row-level security for defense in depth
- per-session/device refresh-session revocation UX
- immutable audit archive stream outside the live transactional database
- ABAC overlays for document metadata, business units, and environment labels
