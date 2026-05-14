# PRD: Remote Docs Admin Web Interface

## 1. Summary

Add an optional admin web interface for the Remote Docs Intelligence MCP service. The interface will let operators inspect indexed documentation sources, monitor retrieval and indexing KPIs, search indexed docs, review refresh jobs, trigger controlled indexing actions, retry failed work, and tombstone or purge indexed source content before reindexing.

The admin interface must run separately from the MCP HTTP server so deployments can start only the docs MCP endpoint and worker when no human admin console is needed. The recommended implementation is a BHVR-inspired workspace addition using Bun, Hono, Vite, React 19, and shared TypeScript contracts, without moving the existing MCP source tree in V1.

This PRD is documentation only. It does not implement workspaces, admin auth, routes, UI, schema migrations, Docker services, or tests. Implementation must happen later through the task plan under `docs/tasks/bun-dev-intel-mcp-admin-web-interface/`.

## 2. Motivation

The remote docs implementation already stores source-backed documentation pages, chunks, embeddings, refresh jobs, retrieval events, freshness metadata, and tombstone state. Today that state is available only through MCP tools, logs, tests, and direct database inspection.

That is enough for agent consumption, but weak for operation:

- Operators cannot quickly tell whether an index is healthy.
- Failed refresh jobs require database inspection to diagnose.
- Search quality is hard to monitor over time.
- Manual refresh and retry workflows are not ergonomic.
- Destructive workflows such as disabling indexed content or rebuilding a source are not guarded by an admin UX.

The admin web interface should make the docs index observable and controllable while keeping the existing docs-only MCP server small and focused.

## 3. Target Users

- Project maintainers operating the remote docs MCP service.
- Developers validating ingestion, retrieval quality, and source freshness during local Docker runs.
- Admin users who need to retry failed jobs or trigger source refreshes without touching SQL directly.
- Future maintainers adding additional documentation source packs.

The UI is not a public documentation search product. It is an internal admin tool.

## 4. Goals

- Provide a secure admin-only web interface for indexed docs operations.
- Keep the admin console optional and separately startable from the MCP HTTP server.
- Add username/password admin authentication with roles.
- Support admin and viewer users.
- Show source/index health for configured documentation sources.
- Show KPIs across `1h`, `24h`, `7d`, and `30d` windows.
- Let admins search indexed docs from the browser using the same retrieval path as MCP `search_docs`.
- Let admins view sources, pages, chunks, embeddings coverage, freshness, tombstones, and refresh jobs.
- Let admins trigger manual refresh for an entire source.
- Let admins retry failed jobs.
- Let admins run a guarded full purge plus reindex workflow for a source.
- Use disable/tombstone semantics for deletion-style actions in V1 rather than broad unguarded physical deletes.
- Keep source definitions view-only in V1. Source packs remain configured in code.
- Add a small admin audit trail for authentication and mutation actions.
- Use shared Zod contracts between the admin backend and frontend.
- Make the implementation test-driven and compatible with the existing Bun-first repo.

## 5. Non-Goals For V1

- Do not move the existing MCP server from `src/` into a new `server/` package.
- Do not require the admin console to run when the MCP HTTP server runs.
- Do not expose local project filesystem analysis in the admin interface.
- Do not add public, anonymous, or SEO-facing documentation search.
- Do not let admins create arbitrary source packs or crawl non-allowlisted URLs.
- Do not add OAuth, SSO, SCIM, or multi-tenant organization management.
- Do not execute shell commands from the admin backend.
- Do not physically delete all source data through a one-click action without tombstone/audit safeguards.
- Do not make the React frontend talk directly to Postgres.
- Do not put admin credentials, bearer tokens, or database credentials into the frontend bundle.
- Do not replace the existing MCP Streamable HTTP endpoint or docs worker.

## 6. Product Scope

### Implementation Target

- Runtime and package manager: Bun.
- Admin backend: Hono on Bun.
- Frontend: React 19 and Vite.
- Build tool: Vite.
- Language: TypeScript.
- Shared contracts: Zod v4-compatible schemas in a workspace package.
- Database: existing Postgres database used by remote docs.
- Session storage: Postgres-backed admin sessions.
- Password hashing: Bun password hashing APIs.
- Test runner: `bun:test` for backend packages; frontend component tests may use Vitest when browser-like rendering is needed.
- Browser verification: Playwright for critical admin flows.
- Deployment: optional Docker service for the admin console, separate from MCP HTTP and worker services.

### Source Revalidation

Implementation must revalidate package and framework assumptions before dependency changes. As of 2026-05-14:

- BHVR docs describe a Bun + Hono + Vite + React workspace shape with `client/`, `server/`, `shared/`, and root workspaces.
- React docs list the latest React version as `19.2`.
- Vite docs list `v8.0.10` in the current documentation navigation and support Bun scaffolding with `bun create vite`.
- Bun homepage lists Bun `v1.3.14`.

Exact package versions must be selected during Task 00 and recorded in a source revalidation note before implementation.

### Recommended Repository Structure

Use a BHVR-inspired monorepo addition without migrating the existing MCP code in V1.

Recommended layout:

```text
.
├── src/                                  # Existing MCP server, docs worker, storage, retrieval
├── apps/
│   └── admin-console/
│       ├── client/                       # React 19 + Vite admin UI
│       └── server/                       # Hono admin API and static frontend host
├── packages/
│   └── admin-contracts/                  # Shared Zod schemas, DTOs, route types
├── docs/
│   ├── prd/
│   └── tasks/
└── package.json                          # Root workspaces and shared scripts
```

Rationale:

- It gives the admin UI BHVR's useful separation of frontend, backend, and shared types.
- It avoids a high-risk move of the existing production MCP source tree.
- The admin console can be built and deployed as one optional container.
- The existing `src/http.ts` and `src/docs-worker.ts` remain independently startable.
- Shared contracts prevent drift between UI forms, API responses, and backend validation.

V1 should not use the BHVR CLI template wholesale unless the generated structure can be adopted without moving or rewriting existing source. A manual BHVR-style workspace is safer for this repository.

### Serving Model

The admin interface should be a separate service from the MCP HTTP server:

- `mcp-http`: existing Streamable HTTP MCP server at `/mcp`.
- `docs-worker`: existing refresh worker.
- `admin-console`: new optional Hono server that serves admin API routes and the built React app.

Production:

- The admin console container serves the built Vite assets and the Hono admin API on the same origin.
- Browser requests use same-origin `/api/admin/*` routes.
- The admin console connects to Postgres through `DATABASE_URL`.
- The admin console does not proxy or expose MCP bearer tokens.

Development:

- Vite runs the client dev server.
- Hono runs the admin API server.
- Vite proxies `/api/admin/*` to the admin API server.
- Both use the same shared contracts package.

This keeps deployment simple while preserving the ability to start only the MCP server and worker.

### UI Dependency Direction

The PRD permits a component and chart stack. Implementation should prefer a modest set:

- `lucide-react` for icons.
- `recharts` for KPI charts.
- `@tanstack/react-query` for API data fetching and cache invalidation.
- `react-router` or an equivalent lightweight router for admin routes.
- Radix/shadcn-style primitives may be used if added intentionally and documented in the package plan.

Avoid a heavy dashboard framework in V1. The UI should be dense, operational, and readable rather than marketing-oriented.

## 7. Authentication And Authorization

### User Model

Add admin-console users with username or email plus password.

Roles:

- `admin`: can read all admin views and run mutation actions.
- `viewer`: can read dashboards, sources, pages, chunks, jobs, audit events, and search. Cannot trigger refresh, retry, tombstone, purge, or reindex.

V1 does not need arbitrary custom permissions.

### Bootstrap

The admin console must support a safe initial bootstrap path.

Acceptable implementation:

- On startup, if no admin user exists and bootstrap env vars are present, create the first admin user.
- Required env vars:
  - `ADMIN_BOOTSTRAP_EMAIL`
  - `ADMIN_BOOTSTRAP_PASSWORD`
- The bootstrap password must be hashed before storage.
- The password must not be logged.
- If users already exist, bootstrap env vars must not overwrite them.

Alternative:

- Provide a local Bun script to create the first admin user.
- The script must not be required in normal container startup.

### Sessions

Use server-side sessions:

- `admin_sessions` table with opaque random session tokens.
- Store only a hash of the session token.
- Send session cookie as `HttpOnly`, `SameSite=Lax` or stricter, and `Secure` in production.
- Include session expiry and rotation on login.
- Support logout by revoking the current session.

### Login Protection

The admin API must:

- Validate credentials with constant-time-safe comparison behavior provided by the password API.
- Rate-limit repeated failed login attempts by email and IP.
- Return generic login failure messages.
- Log login success and failure in the admin audit trail without storing raw passwords.

### API Authorization

Every admin API route except login and health must require an authenticated session.

Mutation routes must require `admin`.

The frontend must hide admin-only actions for viewer users, but the backend remains the authority.

## 8. Admin API

Admin API routes should live under `/api/admin`.

All responses should use shared contract schemas from `packages/admin-contracts`.

### 8.1 Auth Routes

```text
POST /api/admin/auth/login
POST /api/admin/auth/logout
GET  /api/admin/auth/me
```

Login input:

```json
{
  "email": "string",
  "password": "string"
}
```

`GET /me` output:

```json
{
  "ok": true,
  "user": {
    "id": "string",
    "email": "string",
    "role": "admin | viewer"
  }
}
```

### 8.2 Dashboard Routes

```text
GET /api/admin/overview?window=1h|24h|7d|30d
GET /api/admin/kpis?window=1h|24h|7d|30d
```

Overview should include:

- total sources
- enabled indexed sources
- total pages
- total chunks
- total embeddings
- embedding coverage percentage
- stale pages
- tombstoned pages
- queued jobs
- running jobs
- failed jobs in selected window
- searches in selected window
- zero-result rate
- low-confidence rate
- stale-result rate when telemetry supports it
- refresh-triggered-by-search count

### 8.3 Source And Content Routes

```text
GET /api/admin/sources
GET /api/admin/sources/:sourceId
GET /api/admin/sources/:sourceId/pages
GET /api/admin/sources/:sourceId/pages/:pageId
GET /api/admin/sources/:sourceId/chunks/:chunkId
```

Sources are view-only as source definitions. V1 may show configured source-pack metadata and stored source stats, but must not allow arbitrary source creation or allowlist editing from the UI.

Page list filters:

- `q`
- `freshness=fresh|stale|expired|tombstoned`
- `hasEmbedding=true|false`
- `limit`
- `cursor`

Page detail should include:

- canonical URL
- title
- content hash
- HTTP status
- fetched/indexed/expires timestamps
- tombstone status and reason
- chunk count
- embedding count
- chunks with heading paths and token estimates

### 8.4 Refresh Job Routes

```text
GET  /api/admin/jobs
GET  /api/admin/jobs/:jobId
POST /api/admin/jobs/:jobId/actions/retry
```

Job filters:

- source ID
- status
- job type
- reason
- time window
- URL substring

Retry behavior:

- Only failed jobs can be retried in V1.
- Retrying should create a new queued job with equivalent source, URL, and job type, using reason `manual`.
- The original failed job must remain unchanged.
- The admin audit log must link the retry action to the original job ID.

### 8.5 Search Route

```text
POST /api/admin/search
```

Input:

```json
{
  "query": "string",
  "sourceId": "string",
  "mode": "hybrid | keyword | semantic",
  "limit": "number",
  "forceRefresh": "boolean?"
}
```

The admin search route should call the same retrieval service and refresh queue behavior as MCP `search_docs`, but return UI-oriented fields:

- title
- URL
- heading path
- snippet
- scores
- freshness
- confidence
- source citations
- page ID
- chunk ID
- fetched/indexed timestamps
- refresh queued status
- warnings

### 8.6 Source Action Routes

```text
POST /api/admin/sources/:sourceId/actions/refresh
POST /api/admin/sources/:sourceId/actions/tombstone
POST /api/admin/sources/:sourceId/actions/purge-reindex
```

Refresh:

- Enqueue a `source_index` job with reason `manual`.
- Deduplicate through the existing refresh queue.
- Return queued, deduplicated, skipped, or rejected status.

Tombstone:

- Mark indexed pages for the source as tombstoned with an admin reason.
- Do not alter source-pack allowlist configuration.
- Do not remove source definitions from code or database.
- Require admin confirmation input.

Purge plus reindex:

- V1 should use a guarded workflow:
  1. confirm source ID typed by admin
  2. create an admin audit event
  3. tombstone current indexed pages with reason `admin_purge_reindex`
  4. enqueue a manual `source_index` job
  5. leave physical deletion or compaction for a later maintenance task unless a focused implementation task adds a controlled prune policy

This satisfies the operator need to remove active indexed content while preserving auditability and rollback context.

### 8.7 Audit Routes

```text
GET /api/admin/audit-events
```

Events should include:

- login success/failure
- logout
- manual source refresh
- failed job retry
- source tombstone
- purge plus reindex
- user creation or role change if implemented

Do not store passwords, session tokens, API keys, bearer tokens, or raw document content in audit details.

## 9. Data Model Changes

### 9.1 Admin Users

Add:

```text
admin_users
```

Fields:

- `id`
- `email`
- `password_hash`
- `role`
- `disabled_at`
- `last_login_at`
- `created_at`
- `updated_at`

Constraints:

- unique normalized email
- role check: `admin`, `viewer`
- disabled users cannot create new sessions

### 9.2 Admin Sessions

Add:

```text
admin_sessions
```

Fields:

- `id`
- `user_id`
- `session_token_hash`
- `expires_at`
- `revoked_at`
- `created_at`
- `last_seen_at`
- `user_agent_hash`
- `ip_hash`

Session token hashes must be indexed. Raw tokens must never be stored.

### 9.3 Admin Audit Events

Add:

```text
admin_audit_events
```

Fields:

- `id`
- `actor_user_id`
- `event_type`
- `target_type`
- `target_id`
- `details`
- `created_at`
- `ip_hash`
- `user_agent_hash`

Details must be JSON with redaction helpers.

### 9.4 Retrieval Telemetry Extension

Existing `doc_retrieval_events` supports query hash, mode, result count, confidence, low confidence, refresh queued, and created timestamp.

To support richer KPIs, implementation should consider adding:

- `freshness`
- `refresh_reason`
- `top_score`
- `duration_ms`

If the implementation chooses not to migrate telemetry in V1, the UI must label unavailable KPIs clearly and compute only supported metrics.

### 9.5 Source Tombstone Bulk Operation

Existing page tombstone fields support page-level tombstones. Add storage helpers for source-level bulk tombstone:

```ts
tombstonePagesForSource(input: {
  sourceId: string;
  reason: string;
  now: string;
}): Promise<{ pageCount: number }>;
```

The operation should be bounded or transactional according to table size. It must not bypass source allowlist policy.

## 10. UI Requirements

### 10.1 Overall Experience

The admin UI should feel like an operational console:

- compact navigation
- dense tables
- clear statuses
- readable charts
- predictable filters
- confirmation dialogs for mutation actions
- no marketing hero sections
- no decorative card-heavy landing page

Primary navigation:

- Overview
- Sources
- Jobs
- Search Lab
- Audit
- Users, if user management is included in V1

### 10.2 Login

Login screen:

- email
- password
- submit
- generic error message
- loading and disabled states

After login:

- redirect to Overview
- fetch `/api/admin/auth/me`
- keep session state in React Query

### 10.3 Overview

The Overview page should show:

- window selector: `1h`, `24h`, `7d`, `30d`
- source count
- page count
- chunk count
- embedding coverage
- stale page count
- tombstoned page count
- queued/running/failed job counts
- searches
- zero-result rate
- low-confidence rate
- stale-result rate when available
- refresh-triggered count

Charts:

- searches over time
- job status counts over time
- embedding coverage by source
- failed jobs by type

### 10.4 Sources

Sources list:

- source ID
- display name
- enabled indexed state
- page count
- chunk count
- embedding coverage
- stale pages
- tombstoned pages
- oldest fetched page
- newest indexed page
- latest successful source refresh
- latest failed job

Source detail:

- source-pack metadata
- indexed stats
- action panel for admins
- pages table
- recent jobs table

Admin actions:

- refresh source
- tombstone indexed content
- purge plus reindex

Every destructive action requires:

- modal confirmation
- typed source ID confirmation for tombstone and purge/reindex
- audit event
- success/failure toast or inline result

### 10.5 Jobs

Jobs page:

- table with status, type, reason, source, URL, priority, attempts, run-after, created, updated, finished
- status filters
- source filters
- failed-only quick filter
- job detail drawer or page
- sanitized error display
- retry action for failed jobs if user role is `admin`

The UI must not show raw secrets from error payloads.

### 10.6 Search Lab

Search Lab:

- query input
- source selector
- mode segmented control
- limit input
- optional force refresh toggle
- results list
- scoring details
- freshness and confidence badges
- warnings
- source citations
- link to page and chunk detail

This page is for admins/debugging only, not public docs search.

### 10.7 Audit

Audit page:

- event type filter
- actor filter
- target filter
- time window
- event detail drawer

Audit details must be concise and redacted.

### 10.8 Users

V1 may include minimal user management if it fits the implementation budget:

- list users
- create viewer/admin user
- disable user
- change role
- reset password

If user management is deferred, the PRD still requires at least bootstrap admin creation and authenticated sessions.

## 11. Security Requirements

- Admin API must use cookie-based sessions, not MCP bearer tokens.
- Admin credentials must never be exposed to the frontend bundle.
- Passwords must be hashed before storage.
- Session tokens must be random, opaque, and stored only as hashes.
- Mutation routes must verify session role server-side.
- API must validate request bodies with shared Zod schemas.
- API must enforce Origin or same-origin checks for mutation routes.
- Cookies must be `HttpOnly`.
- Cookies must be `Secure` when `ADMIN_COOKIE_SECURE=true` or production mode is enabled.
- Login failures must be rate-limited.
- Audit logs must redact tokens, API keys, passwords, authorization headers, embedding payloads, and full page content.
- Admin API must not expose arbitrary SQL querying.
- Admin API must not allow arbitrary URL ingestion outside configured source-pack policy.
- Admin API must not read project files or local analyzed project paths.

## 12. Deployment And Configuration

### Environment Variables

Admin console:

```text
ADMIN_HTTP_HOST=0.0.0.0
ADMIN_HTTP_PORT=3100
ADMIN_SESSION_SECRET=<long-random-secret>
ADMIN_COOKIE_SECURE=true
ADMIN_BOOTSTRAP_EMAIL=<initial-admin-email>
ADMIN_BOOTSTRAP_PASSWORD=<initial-admin-password>
DATABASE_URL=<same-remote-docs-postgres-url>
```

Optional:

```text
ADMIN_ALLOWED_ORIGINS=https://admin.example.com
ADMIN_SESSION_TTL_SECONDS=604800
ADMIN_LOGIN_RATE_LIMIT_WINDOW_SECONDS=900
ADMIN_LOGIN_RATE_LIMIT_MAX_ATTEMPTS=10
```

### Docker Compose

Add an optional `admin-console` service:

- depends on Postgres readiness
- does not depend on MCP HTTP being started
- can be enabled through a compose profile such as `admin`
- exposes only `ADMIN_HTTP_PORT`
- receives `DATABASE_URL` and admin env vars

The existing MCP server and worker compose services remain separate.

### Production Serving

The admin server should serve:

- `/api/admin/*` through Hono.
- static Vite build output for all other frontend routes.
- `GET /healthz` for liveness.
- `GET /readyz` for database readiness.

## 13. Testing And Quality

### Backend Tests

Use `bun:test` for:

- admin config parsing
- password hashing and login behavior
- session creation, lookup, expiry, revocation
- role-based authorization
- admin route validation
- KPI aggregation queries
- source stats routes
- refresh source action
- failed job retry action
- tombstone action
- purge plus reindex action
- audit event redaction

Postgres integration tests should remain gated by `TEST_DATABASE_URL`.

### Frontend Tests

Use frontend test tooling for:

- login form states
- authenticated route guard
- overview KPI rendering
- source table filtering
- job retry confirmation
- purge/reindex confirmation
- search lab result rendering
- role-based action visibility

### Browser Smoke Tests

Use Playwright for:

- login and logout
- overview loads with seeded stats
- source detail shows pages/jobs
- search lab can query seeded docs
- admin can retry a failed job
- viewer cannot run mutation actions

### Gates

Required gates after implementation:

```bash
bun test
bun run typecheck
bun run check
```

Admin workspace-specific scripts may be added, but the root `check` command must cover the admin console before final completion.

## 14. Acceptance Criteria

- Admin console can be started without starting the MCP HTTP server.
- MCP HTTP server can still be started without starting the admin console.
- Admin login uses stored users and password hashes, not MCP bearer tokens.
- Viewer users cannot run mutation actions.
- Admin users can trigger source refresh.
- Admin users can retry failed jobs.
- Admin users can run guarded tombstone and purge-plus-reindex workflows.
- Source definitions are view-only.
- Search Lab uses the same retrieval behavior as MCP docs search.
- Overview shows KPIs for `1h`, `24h`, `7d`, and `30d`.
- Sources UI shows pages, chunks, embedding coverage, freshness, and tombstones.
- Jobs UI shows queued, running, succeeded, and failed jobs with sanitized error details.
- Admin actions create audit events.
- Docker compose can run the admin console as an optional service.
- Existing stdio tools, MCP HTTP tools, and docs worker behavior remain compatible.

## 15. Implementation Strategy

Implement in small, focused tasks:

1. Revalidate official sources and select package versions.
2. Add workspace scaffolding and shared admin contracts.
3. Add admin auth schema, storage, bootstrap, and sessions.
4. Add admin read models for KPIs, sources, pages, chunks, jobs, and audit.
5. Add admin API routes.
6. Add React app shell, login, routing, and API client.
7. Add Overview, Sources, Jobs, Search Lab, and Audit views.
8. Add guarded mutation workflows and audit logging.
9. Add Docker/deployment docs.
10. Run final QA and traceability.

Do not combine unrelated backend, frontend, and deployment changes in a single task unless the task file explicitly scopes that integration.

## 16. Open Risks

- Full source purge semantics need care because V1 prefers tombstone/disable over physical deletion.
- Existing retrieval telemetry does not yet capture every KPI needed for stale-result and latency charts.
- Moving to root workspaces may affect current `bun install`, `bun test`, and TypeScript behavior.
- Admin auth introduces a new security surface that must be tested more rigorously than read-only MCP routes.
- Frontend dependencies can grow quickly. Keep the component/chart stack intentional and documented.

## 17. References

- BHVR getting started: `https://bhvr.dev/getting-started`
- React versions: `https://react.dev/versions`
- Vite guide: `https://vite.dev/guide/`
- Bun homepage: `https://bun.com/`
- Remote docs HTTP PRD: `docs/prd/bun-dev-intel-mcp-remote-docs-http.md`
- Remote docs worker reliability PRD: `docs/prd/bun-dev-intel-mcp-remote-docs-worker-reliability.md`
