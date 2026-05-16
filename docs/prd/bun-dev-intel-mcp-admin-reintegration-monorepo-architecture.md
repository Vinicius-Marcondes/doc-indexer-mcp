# PRD: Admin Console Reintegration And Monorepo Architecture

## 1. Summary

Reintegrate the split-out `admin-console` project back into the `doc-repository-mcp` Git repository and restructure the codebase into a Bun-first monorepo with explicit application and package boundaries.

The admin console, MCP HTTP server, docs worker, database schema, migrations, retrieval contracts, source policy, and operational workflows are tightly coupled around the same remote-docs domain. The current split repository model has produced duplicated source code, duplicated deployment scaffolding, split migration ownership, and cross-repository coordination requirements. This PRD defines the incremental target architecture for bringing those concerns back under one repository without collapsing them into one process or one unstructured source tree.

This PRD is documentation only. It must not implement code, move files, change package scripts, change Docker files, or alter tests by itself. Implementation must happen later through focused task files and small pull requests after review.

## 2. Decision Record

These decisions are part of the product and architecture requirements for this effort:

- The canonical Git target is the existing `doc-repository-mcp` repository because it is already connected to GitHub.
- Do not adopt BHVR as a framework-level dependency or generated template for this migration.
- Use a BHVR-inspired stack shape only where it is useful: Bun, Hono, Vite, React, and shared TypeScript workspaces.
- Use a domain-first monorepo design rather than a template-first design.
- Keep `mcp-http`, `docs-worker`, and `admin-console` as separately startable and separately deployable processes.
- Use one database schema ownership model and one migration stream.
- Keep migrations at root under `migrations/remote-docs/`.
- Use internal workspace packages for shared domain logic, DB access, contracts, and config.
- Serve the built admin client from the admin server in production.
- Make the migration incremental so the existing MCP HTTP server and worker keep working throughout the transition.

## 3. Context

The remote docs service currently owns:

- MCP Streamable HTTP endpoint.
- Docs search and retrieval tools.
- Docs resources.
- Source policy and source packs.
- Docs ingestion, chunking, embeddings, retrieval, refresh, tombstone behavior, and telemetry.
- Postgres and pgvector schema.
- Docker and Compose setup for MCP HTTP, docs worker, and Postgres.

The split admin console currently owns:

- Admin API.
- Admin React client.
- Admin auth and sessions.
- Admin read models.
- Admin actions for refresh, retry, tombstone, and purge/reindex.
- Admin audit events.
- A copied dependency closure of the docs service: docs storage, retrieval, source packs, embeddings, refresh queue, cache helpers, tools, contracts, and migrations.

The split is no longer matching the dependency graph. The admin console is not merely a separate UI over a stable remote API. It directly consumes the same database schema and reuses the same domain logic as the MCP service.

## 4. Problem

The current repository separation creates avoidable risk and overhead:

- The docs domain code exists in both repositories and can drift.
- Schema ownership is split: docs tables live with the MCP project, while admin auth and audit migrations live with the admin project.
- Operational workflows need both projects to agree on refresh jobs, source IDs, tombstone semantics, retrieval telemetry, and freshness logic.
- Contract changes require cross-repository coordination.
- Local development requires more setup than the system complexity justifies.
- CI/CD has to decide which repo owns tests for shared behavior.
- The admin console cannot evolve safely when DB and domain changes land first in the MCP repo.
- The MCP repo cannot evolve safely when admin read models or operational actions depend on tables and semantics that live elsewhere.

The system needs code separation, but repository separation is not buying meaningful independence at this stage.

## 5. Target Users

- Maintainers operating the remote docs MCP service.
- Developers evolving docs ingestion, retrieval, refresh, and admin workflows.
- Agents working on the repository who need clear architecture boundaries.
- Future maintainers adding more documentation source packs or operational views.

## 6. Goals

- Merge admin-console source ownership back into `doc-repository-mcp`.
- Preserve separate runtime boundaries for MCP HTTP, docs worker, and admin console.
- Establish a monorepo layout with apps and internal packages.
- Remove duplicated docs-domain source after an incremental transition.
- Centralize database migrations and schema ownership.
- Centralize shared contracts and types used by MCP, admin backend, admin frontend, tests, and docs worker.
- Keep the current MCP HTTP behavior working during every migration phase.
- Keep the current docs worker behavior working during every migration phase.
- Keep the admin console behavior working when it is integrated.
- Maintain source policy, security, audit, and freshness guarantees.
- Improve developer experience by making local setup, tests, type-checking, and builds understandable from one repo.
- Make implementation test-driven with meaningful coverage at each step.
- Avoid broad rewrites, large hidden behavior changes, or one-shot file moves that are hard to review.

## 7. Non-Goals

- Do not implement this PRD directly without task breakdown and review.
- Do not collapse all services into one runtime process.
- Do not route all admin operations through the MCP server just to force a service boundary.
- Do not split admin frontend, admin backend, and MCP server into separate repositories.
- Do not introduce a new service mesh, queue system, or infrastructure platform for V1.
- Do not replace Bun, Hono, React, Vite, Postgres, pgvector, or Zod as part of this migration.
- Do not change the source allowlist as part of the restructure.
- Do not add new product capabilities beyond preserving existing admin and remote-docs behavior.
- Do not physically delete existing source data as part of migration.
- Do not change embedding dimensionality, search ranking semantics, or refresh policy unless a task explicitly requires it.
- Do not require the admin console to be deployed when only MCP HTTP and worker are needed.
- Do not expose admin credentials, database credentials, or MCP bearer tokens to the frontend bundle.
- Do not read or vendor dependencies from `node_modules`.

## 8. Architecture Recommendation

Use a single monorepo with multiple applications and internal packages.

Final target layout:

```text
doc-repository-mcp/
  apps/
    mcp-http/
      src/
    docs-worker/
      src/
    admin-console/
      server/
        src/
      client/
        src/

  packages/
    docs-domain/
      src/
    db/
      src/
    contracts/
      src/
    admin-contracts/
      src/
    config/
      src/

  migrations/
    remote-docs/

  tests/
    unit/
    integration/
    e2e/
    live/

  docs/
    prd/
    tasks/
    deployment/

  package.json
  bun.lock
  tsconfig.json
  Dockerfile
  docker-compose.yml
  AGENTS.md
```

The migration does not need to reach this layout in one PR. Early phases may keep existing `src/` entrypoints and create package facades. The final architecture should converge on apps importing from packages, not apps importing from other apps.

## 9. Application Responsibilities

### 9.1 `apps/mcp-http`

Owns the MCP HTTP runtime boundary.

Responsibilities:

- Start the MCP HTTP server.
- Parse MCP HTTP runtime config through shared config helpers.
- Host `/healthz` and `/readyz`.
- Enforce bearer auth, origin checks, query-token rejection, and request body limits for `/mcp`.
- Register docs-only MCP tools and resources.
- Adapt domain results into MCP structured content and text content.
- Log MCP tool/resource calls through the existing audit logger behavior.

Must not own:

- Source discovery logic.
- Ingestion orchestration.
- Embedding provider implementation.
- SQL queries.
- Admin auth.
- Admin read models.
- Admin UI static assets.

### 9.2 `apps/docs-worker`

Owns the worker process boundary.

Responsibilities:

- Parse worker runtime config through shared config helpers.
- Run scheduled and on-demand refresh work.
- Recover stale running jobs.
- Enforce source-level job rules.
- Call docs-domain ingestion and refresh services.
- Emit safe operational logs.

Must not own:

- HTTP routing.
- MCP transport.
- Admin sessions.
- React assets.
- Database schema definitions outside migrations.

### 9.3 `apps/admin-console/server`

Owns the admin API and static admin hosting boundary.

Responsibilities:

- Start the admin Hono server.
- Serve built Vite assets in production.
- Expose `/healthz` and `/readyz`.
- Expose `/api/admin/*` routes.
- Manage admin auth, sessions, login protection, logout, and current user routes.
- Provide admin read models for overview, KPIs, sources, pages, chunks, jobs, and audit events.
- Provide guarded admin actions for refresh, retry, tombstone, and purge/reindex.
- Write admin audit events.
- Call shared docs-domain and db packages directly.

Must not own:

- MCP bearer-token authentication.
- MCP transport.
- Source policy implementations.
- Retrieval ranking logic.
- Low-level DB migration runner.
- Frontend build configuration beyond serving built assets.

### 9.4 `apps/admin-console/client`

Owns the browser UI.

Responsibilities:

- React and Vite application.
- Same-origin API client for `/api/admin/*`.
- Authenticated admin shell.
- Operational dashboards.
- Source, page, chunk, job, audit, and search views.
- Viewer/admin role UI affordances.

Must not own:

- Secrets.
- Direct database access.
- MCP bearer-token handling.
- Source allowlist decisions.
- Business rules that must be enforced by the server.

## 10. Package Responsibilities

### 10.1 `packages/docs-domain`

Owns remote-docs business logic.

Responsibilities:

- Source-pack contracts.
- Bun source pack and future source packs.
- Source policy and URL validation.
- Docs discovery and page fetching orchestration interfaces.
- Content normalization.
- Chunking.
- Embedding provider abstraction and provider adapters.
- Freshness policy.
- Tombstone policy.
- Refresh queue policy.
- Ingestion pipeline.
- Retrieval service contracts and ranking behavior.
- Keyword, vector, and hybrid retrieval domain semantics.
- Tool-level docs operations such as `searchDocs` and `getDocPage`, when implemented as transport-neutral services.

Package rules:

- Must be testable without starting HTTP servers.
- Must not import app packages.
- Must not depend on React.
- Must keep source policy explicit and test-covered.
- Should depend on storage interfaces rather than hard-coding app runtime concerns.

### 10.2 `packages/db`

Owns database access and migrations.

Responsibilities:

- Postgres client factory.
- Migration loader and runner.
- Remote-docs storage adapters.
- Admin auth storage.
- Admin read model storage.
- Admin action storage.
- Row mappers.
- Database readiness checks.
- Test harness helpers for integration tests.
- SQL type boundaries.

Package rules:

- SQL must stay concentrated here unless a task explicitly justifies an exception.
- Migrations must be loaded from root `migrations/remote-docs/`.
- Storage methods must return typed domain objects, not raw rows, except in private helpers.
- Row interfaces may remain snake_case internally.
- Public application-facing objects must use camelCase.

### 10.3 `packages/contracts`

Owns shared docs and MCP-adjacent contracts.

Responsibilities:

- Zod schemas and TypeScript types for docs search, page retrieval, resources, errors, source citations, freshness, confidence, retrieval metadata, and shared response shapes.
- Structured error contracts.
- Transport-neutral schemas used by MCP and admin search.

Package rules:

- No database imports.
- No app imports.
- No runtime side effects.
- Zod schemas must be the source of truth for public DTO validation.

### 10.4 `packages/admin-contracts`

Owns admin API contracts.

Responsibilities:

- Admin auth request and response schemas.
- Admin role schemas.
- Admin overview, KPI, source, page, chunk, job, audit, and action schemas.
- Admin search request and response schemas.
- Pagination contracts.
- Client-consumable route DTOs.

Package rules:

- Must be safe to import in browser code.
- Must not import server-only modules.
- Must not import database clients.
- Must not expose secrets or server implementation details.

### 10.5 `packages/config`

Owns shared runtime config parsing when extraction is useful.

Responsibilities:

- MCP HTTP config parser.
- Worker config parser.
- Admin runtime config parser.
- Shared helpers for integer, boolean, URL, Postgres URL, allowed origins, and embedding config validation.

Package rules:

- Config parsing must produce structured issues.
- Config must not perform network or database IO.
- App packages own process startup and decide how to render config failures.

## 11. Dependency Direction

Allowed dependency direction:

```text
apps/* -> packages/*
packages/docs-domain -> packages/contracts
packages/docs-domain -> packages/db interfaces or db types only when required
packages/db -> packages/contracts
packages/admin-contracts -> no internal runtime packages
packages/config -> no app packages
```

Disallowed dependency direction:

```text
packages/* -> apps/*
apps/mcp-http -> apps/admin-console/*
apps/admin-console/server -> apps/mcp-http/*
apps/admin-console/client -> packages/db
apps/admin-console/client -> packages/docs-domain server-only exports
packages/contracts -> packages/db
packages/admin-contracts -> packages/db
```

Implementation must avoid cross-app relative imports such as importing from `../../../../src/docs/...` once the relevant package extraction has happened. During early migration phases, temporary compatibility imports are allowed only when a task documents the exit plan.

## 12. Database And Migration Strategy

### 12.1 Single Migration Authority

All schema changes for docs and admin must live in:

```text
migrations/remote-docs/
```

This includes:

- `doc_sources`
- `doc_pages`
- `doc_chunks`
- `doc_embeddings`
- `doc_refresh_jobs`
- `doc_retrieval_events`
- `admin_users`
- `admin_sessions`
- `admin_audit_events`
- Future admin operational tables

The migration loader must read that single directory in sorted order.

### 12.2 Migration Requirements

- Migrations must be idempotent where practical.
- New migrations must be additive by default.
- Destructive schema changes require a separate PRD or explicit task approval.
- Migrations must preserve existing local and production data.
- Every migration must have integration test coverage through the DB test harness.
- Admin migrations from the split repo must be imported into the canonical migration stream without changing table semantics.
- Migration filenames must preserve ordering and make ownership clear.

Recommended imported sequence:

```text
0001_remote_docs_schema.sql
0002_admin_auth_schema.sql
0003_admin_audit_events.sql
```

If the target repo already contains later migrations when implementation starts, the admin migrations must be renumbered carefully and documented.

### 12.3 Schema Integrity Requirements

- Admin sessions must store only token hashes.
- Admin audit events must never store raw passwords or bearer tokens.
- Docs embeddings must retain provider, model, version, and dimensions checks.
- Source IDs must remain stable.
- Refresh job status, type, and reason constraints must remain aligned with TypeScript contracts.
- Tombstone state must remain reversible only through explicit reindex flows.
- Migrations must not silently drop indexes used by retrieval or admin read models.

## 13. Contract And Type Strategy

Contracts must be shared through workspace packages rather than copied files.

Requirements:

- Public request and response shapes use Zod schemas.
- Inferred TypeScript types may be exported from schemas.
- MCP tool input schemas must remain strict.
- Admin API request schemas must remain strict.
- Database row types stay private to `packages/db`.
- Browser-safe packages must not import server-only APIs.
- Contracts must be versioned by repository commits, not by separately published package versions for V1.
- If external publishing is ever required, it must be handled by a separate PRD.

The admin search API should reuse docs search contracts where possible, but admin-specific response wrappers may live in `admin-contracts`.

## 14. Deployment Topology

Keep separate runtime services:

```text
postgres-pgvector
mcp-http
docs-worker
admin-console
```

### 14.1 Containers

Use one repository build context.

Acceptable container strategies:

1. One multi-target Dockerfile:
   - `mcp-http`
   - `docs-worker`
   - `admin-console`

2. One shared runtime image with different commands:
   - `bun apps/mcp-http/src/index.ts`
   - `bun apps/docs-worker/src/index.ts`
   - `bun apps/admin-console/server/src/index.ts`

The initial implementation should prefer the smallest safe change from the current Docker setup. A multi-target Dockerfile is preferred if it keeps image roles explicit without duplicating install steps.

### 14.2 Compose

The canonical Compose file should define:

- Postgres with pgvector.
- MCP HTTP service on port `3000` by default.
- Docs worker service.
- Admin console service on port `3100` by default, optionally behind an `admin` profile if desired.

Compose must use the same `DATABASE_URL` target for all app services.

### 14.3 Production Runtime

- MCP clients connect only to `/mcp` on the MCP HTTP service.
- Operators use the admin console service.
- The admin console does not expose MCP bearer tokens.
- The worker has no public HTTP surface.
- All services must support health/readiness checks.

## 15. Local Development Experience

The monorepo should support:

- Installing dependencies once at the repo root.
- Running MCP HTTP locally.
- Running docs worker locally.
- Running admin server locally.
- Running admin client locally with Vite.
- Running all tests from root.
- Running focused tests for one package or app.
- Running type-checks from root and per package/app.

Recommended root scripts after migration:

```text
bun run dev:mcp
bun run dev:worker
bun run dev:admin:server
bun run dev:admin:client
bun run test
bun run typecheck
bun run check
bun run build:admin
```

Implementation may add scripts incrementally. The first PR should not require a perfect developer command surface if that would make the migration too large.

## 16. Incremental Migration Plan

### Phase 0: PRD And Task Planning

Deliverables:

- This PRD.
- A task tracker under `docs/tasks/`.
- Traceability checklist.
- Explicit migration order.

Acceptance:

- No code changes.
- No behavior changes.
- Architecture decisions are reviewed before implementation.

### Phase 1: Prepare Monorepo Workspace

Purpose: Make `doc-repository-mcp` capable of hosting apps and packages without moving behavior.

Deliverables:

- Root workspace configuration.
- Internal package naming convention.
- TypeScript project boundaries.
- Initial package folders with minimal exports if needed.
- Existing tests still pass.

Constraints:

- Do not move MCP HTTP behavior yet unless required by workspace setup.
- Do not import admin console yet.
- Avoid dependency churn.

### Phase 2: Import Admin Console Source

Purpose: Bring admin source into the target repo while preserving behavior.

Deliverables:

- `apps/admin-console/server`
- `apps/admin-console/client`
- `packages/admin-contracts`
- Admin tests imported.
- Admin docs imported or linked to this PRD.

Constraints:

- Admin source may temporarily import existing `src/docs` modules until shared packages are extracted.
- No duplicated docs-domain source should be imported into the target repo.
- Admin migrations must be copied into root `migrations/remote-docs/`.

### Phase 3: Centralize Migrations And DB Storage

Purpose: Establish one DB ownership model.

Deliverables:

- `packages/db` owns Postgres client, migration runner, docs storage, admin auth storage, admin read models, and admin action storage.
- Migration runner reads root migrations.
- Storage integration tests cover docs and admin tables.

Constraints:

- Existing `src/docs/storage` imports may be kept as compatibility re-exports only if needed.
- No schema behavior changes except adding imported admin tables.

### Phase 4: Extract Docs Domain

Purpose: Remove shared docs logic from app-level source.

Deliverables:

- `packages/docs-domain` owns source policy, source packs, ingestion, retrieval, refresh, embeddings, tools/services.
- MCP HTTP and admin server import shared docs-domain exports.
- Duplicate docs-domain source is eliminated.

Constraints:

- Keep APIs stable for existing tests.
- Prefer re-export shims for one phase if needed to avoid a giant import rewrite.

### Phase 5: Move Runtime Entrypoints Into Apps

Purpose: Converge on final app layout.

Deliverables:

- MCP HTTP entrypoint in `apps/mcp-http`.
- Docs worker entrypoint in `apps/docs-worker`.
- Admin server entrypoint in `apps/admin-console/server`.
- Legacy root `src/http.ts` and `src/docs-worker.ts` either removed or converted to thin compatibility entrypoints.

Constraints:

- Docker and docs must be updated in the same phase.
- Existing users should have a documented migration path for changed commands.

### Phase 6: Docker, Compose, CI, And Documentation

Purpose: Make the new architecture operational.

Deliverables:

- Dockerfile updated for all app roles.
- Compose updated for all services.
- README and deployment docs updated.
- Root check script covers package/app tests and type-checks.
- CI updated or documented if CI is not yet present.

Constraints:

- Admin console remains optional.
- MCP HTTP and docs worker can still deploy without the admin service.

### Phase 7: Cleanup And Guardrails

Purpose: Remove migration scaffolding and prevent future drift.

Deliverables:

- Remove temporary re-export shims.
- Remove duplicated docs copied from split repo if no longer needed.
- Add import boundary tests or static checks.
- Update AGENTS.md to reflect the new architecture.
- Final traceability checklist.

Constraints:

- Cleanup must happen only after all apps import stable packages.

## 17. Testing Strategy

Implementation must be test-driven. Each task should define the failing test or verification command before code changes.

### 17.1 Test Principles

- Prefer focused tests near the changed behavior.
- Keep default tests deterministic and offline.
- Live network tests remain opt-in.
- DB integration tests must use isolated test databases or isolated schemas.
- Avoid asserting implementation details when public behavior can be asserted.
- Add regression tests for every import-boundary or migration bug fixed during the work.
- Run type-checks after code changes.
- For documentation-only tasks, verify file existence and traceability instead of running the full test suite unless the task asks for it.

### 17.2 Required Test Categories

#### Workspace And Import Boundary Tests

Coverage:

- Apps import packages, not other apps.
- Browser package does not import server-only modules.
- Contracts packages do not import DB or app modules.
- No duplicate docs-domain implementation remains after extraction.

Possible tests:

- Static `rg` or TypeScript boundary test.
- Unit test that scans imports for disallowed patterns.

#### Migration Tests

Coverage:

- Running all migrations from root creates docs and admin tables.
- Running migrations twice is safe where migrations are idempotent.
- Admin auth tables exist with expected constraints.
- Admin audit table exists with expected constraints.
- Existing docs schema constraints still exist.
- Retrieval indexes still exist.

Commands:

```text
bun test tests/integration/storage/migrations.test.ts
```

or a successor under `packages/db`.

#### Storage Tests

Coverage:

- Docs storage behavior remains unchanged.
- Admin auth storage works against canonical migrations.
- Admin sessions store token hashes only.
- Admin read models query canonical docs tables.
- Admin action store writes refresh jobs and audit events.
- Embedding insert idempotency remains preserved.

#### Domain Tests

Coverage:

- Source policy rejects disallowed URLs.
- Bun source pack behavior remains unchanged.
- Chunking remains stable.
- Freshness and tombstone policies remain stable.
- Refresh queue deduplication and bounds remain stable.
- Hybrid retrieval returns expected ranking metadata.
- Search and page services return structured errors for invalid input.

#### MCP HTTP Tests

Coverage:

- `/healthz` works.
- `/readyz` works.
- `/mcp` rejects missing/invalid bearer tokens.
- Query-string bearer tokens are rejected.
- Body limits still apply.
- MCP tools and resources are registered.
- `search_docs`, `get_doc_page`, and `search_bun_docs` behavior remains compatible.

#### Docs Worker Tests

Coverage:

- Worker claims queued jobs.
- Worker recovers stale running jobs.
- Worker marks unexpected job exceptions as failed.
- Source-level exclusivity remains preserved.
- Worker uses shared DB and domain packages.

#### Admin API Tests

Coverage:

- Login validates input.
- Login rate limiting works.
- Sessions are created, validated, and revoked.
- Viewer role cannot mutate.
- Admin role can run guarded actions.
- Admin actions enqueue refresh jobs through shared refresh queue behavior.
- Admin audit events are written for auth and mutation actions.
- Read models return expected KPIs and details.
- Admin search uses the same docs search path as MCP search.

#### Admin Client Tests

Coverage:

- Auth shell renders logged-out and logged-in states.
- Viewer/admin role UI behavior.
- Overview dashboard renders KPIs.
- Source/page/chunk/job views render API data.
- Search lab renders results and warnings.
- Mutation buttons use confirmation flows.
- API errors are visible and do not crash the app.

#### E2E And Browser Verification

Coverage:

- Admin login.
- Dashboard load.
- Search indexed docs.
- Trigger source refresh as admin.
- Confirm viewer cannot trigger mutations.
- Static asset serving from admin server in production build.

Browser tests may be added incrementally once the admin client is integrated.

### 17.3 Meaningful Test Gates By Phase

Phase 1:

```text
bun run typecheck
bun test
```

Phase 2:

```text
bun test
bun run admin:client:build
bun run typecheck
```

Phase 3:

```text
bun test tests/integration/storage
bun run typecheck
```

Phase 4:

```text
bun test tests/unit/docs tests/integration/docs tests/integration/tools
bun run typecheck
```

Phase 5:

```text
bun test tests/integration/http tests/integration/mcp tests/integration/docs/refresh
bun run typecheck
```

Phase 6:

```text
bun run check
docker compose config
```

Docker runtime smoke tests should be documented in deployment tasks and may require local environment variables.

## 18. Performance Requirements

The architecture must preserve or improve current performance characteristics.

### 18.1 Request Path

- MCP search and page requests must not perform ingestion inline.
- Admin search must use the same retrieval path as MCP search.
- Admin read models must use indexed SQL queries and avoid loading full page content for list views.
- Admin list endpoints must be paginated.
- Admin frontend must avoid fetching all pages, chunks, jobs, or audit events at once.
- Health checks must be lightweight.
- Readiness checks may touch DB but must not run migrations or long queries.

### 18.2 Retrieval

- Keyword retrieval must continue using Postgres full-text indexes.
- Vector retrieval must continue using pgvector indexes.
- Hybrid retrieval must bound candidate counts before merging.
- Exact technical term protection must remain intact.
- Query embedding generation must be skipped for keyword-only mode.

### 18.3 Worker

- Worker concurrency must remain configurable.
- Worker must avoid source-level overlap where existing reliability work requires it.
- Embedding writes must remain idempotent.
- Refresh queue bounds must protect the database from unbounded admin-triggered work.

### 18.4 Build And CI

- Root checks should avoid rebuilding the admin client unless needed for the task or release gate.
- Package extraction must not make normal type-checking significantly slower without clear benefit.
- CI should eventually support focused checks by changed path, but this is not required in the first migration PR.

## 19. Security Requirements

- MCP bearer token handling remains isolated to MCP HTTP.
- Admin session cookies must be `HttpOnly`.
- Admin cookies must be `Secure` in production.
- Admin sessions store token hashes only.
- Admin login failures must return generic messages.
- Admin login attempts must be rate-limited.
- Admin mutation routes require `admin` role on the backend.
- Viewer role must remain read-only even if frontend controls are bypassed.
- Admin audit logs must not store raw passwords, API keys, bearer tokens, authorization headers, or full source content.
- Source policy must reject non-allowlisted URLs at every boundary.
- The admin frontend must not receive database credentials, MCP bearer tokens, OpenAI keys, or bootstrap secrets.
- Config parsers must reject invalid or weak required secrets where current behavior requires it.
- Docker and Compose docs must not encourage default production secrets.

## 20. Code Integrity Requirements

- Preserve strict TypeScript settings.
- Keep `.ts` extension import behavior aligned with current repo conventions.
- Keep Zod v4 import conventions.
- Keep app startup functions small and dependency-injected where practical.
- Keep business logic out of HTTP route handlers.
- Keep SQL concentrated in `packages/db`.
- Keep public DTOs validated through contracts packages.
- Avoid circular package dependencies.
- Avoid unrelated refactors inside migration tasks.
- Do not change behavior and move files in the same task unless the task is explicitly a move-only compatibility step.
- Use compatibility re-exports temporarily when they reduce review risk.
- Remove compatibility shims after the final import rewrite phase.
- Update README, deployment docs, AGENTS.md, task trackers, and traceability when behavior or commands change.

## 21. Backward Compatibility

### 21.1 Runtime Compatibility

During migration:

- Existing MCP tools must remain available.
- Existing `/mcp`, `/healthz`, and `/readyz` behavior must remain compatible.
- Existing docs worker behavior must remain compatible.
- Existing database data must remain valid.
- Existing environment variables should continue working until a documented replacement is introduced.

If entrypoint paths change, compatibility entrypoints should remain for at least one migration phase.

### 21.2 Data Compatibility

- Existing docs data must not be dropped.
- Existing refresh jobs must remain readable and processable.
- Existing embeddings must remain compatible.
- Existing retrieval telemetry must remain readable by admin read models.
- Admin tables imported from the split repo must use the same semantics as the current admin implementation.

### 21.3 Contract Compatibility

- MCP response shapes must remain compatible unless a task explicitly updates contracts and tests.
- Admin API contracts should preserve the behavior already implemented in the split admin console when imported.
- Any breaking contract change requires task-level approval and migration notes.

## 22. CI/CD Requirements

The monorepo should eventually have CI checks equivalent to:

```text
bun install --frozen-lockfile
bun run typecheck
bun test
bun run build:admin
```

If CI is introduced or modified:

- It must run deterministic offline tests by default.
- Live docs tests must remain opt-in.
- Docker build checks may run on release or manual workflows if they are expensive.
- Admin client build should be included before releases.
- Failed checks must make it clear which app or package failed.

## 23. Documentation Requirements

Implementation must update documentation as the architecture changes:

- Root README.
- Deployment docs.
- Docker/Compose instructions.
- `.env.example`.
- AGENTS.md architecture section.
- Task tracker.
- Traceability checklist.
- Relevant PRDs if scope changes.

The previous admin web interface PRD remains useful for product requirements, but this PRD supersedes its split-repository and "do not move existing MCP source tree" assumptions.

## 24. Acceptance Criteria

The reintegration is complete when:

- Admin console source lives inside the target `doc-repository-mcp` repo.
- MCP HTTP, docs worker, and admin console are separate startable apps.
- Shared docs-domain code is not duplicated.
- Shared DB access and migration ownership live in the target repo.
- Admin auth and audit migrations live in root `migrations/remote-docs/`.
- Apps import shared logic through workspace packages, not copied source trees.
- Admin client builds from the target repo.
- Admin server serves built admin assets in production.
- MCP HTTP tests pass.
- Docs worker tests pass.
- DB migration and storage tests pass.
- Admin API tests pass.
- Admin client tests and build pass.
- Root type-check passes.
- Docker/Compose configuration represents MCP HTTP, worker, admin, and Postgres.
- README and deployment docs describe the new architecture.
- Temporary compatibility shims are removed or explicitly tracked with cleanup tasks.

## 25. Risks And Mitigations

### Risk: Large File Moves Obscure Behavior Changes

Mitigation:

- Split moves from behavior changes.
- Use move-only PRs where practical.
- Keep compatibility re-exports temporarily.
- Run before/after test gates.

### Risk: Package Extraction Creates Circular Dependencies

Mitigation:

- Define dependency direction before extraction.
- Extract contracts first.
- Extract DB and domain with clear interfaces.
- Add boundary tests.

### Risk: Migration Ordering Breaks Existing Databases

Mitigation:

- Import admin migrations as additive migrations.
- Test fresh and repeated migration runs.
- Do not alter existing docs tables in the same task.

### Risk: Admin Console Accidentally Gains MCP Secrets

Mitigation:

- Keep MCP bearer token parsing only in MCP HTTP config.
- Keep admin config separate.
- Add tests or code review checklist for frontend env exposure.

### Risk: CI Becomes Too Slow

Mitigation:

- Keep focused scripts.
- Add root checks incrementally.
- Avoid unnecessary browser/E2E runs on every small backend task until CI strategy is defined.

### Risk: Existing Deployment Commands Break Abruptly

Mitigation:

- Keep old entrypoint wrappers for one phase.
- Update docs in the same PR as command changes.
- Prefer Compose service names that match current deployment roles.

## 26. Open Questions

These are intentionally left for task planning, not for blocking this PRD:

- Exact internal package names, for example `@bun-dev-intel/docs-domain` versus `@doc-repository/docs-domain`.
- Whether root `src/` remains as compatibility wrappers after final migration or is removed entirely.
- Whether import-boundary checks should be custom tests or a dedicated static analysis tool.
- Whether admin E2E tests should run in default CI or release-only CI.
- Whether Docker should use one shared runtime image or multiple build targets.

## 27. Initial Task Breakdown

Create task files under:

```text
docs/tasks/bun-dev-intel-mcp-admin-reintegration-monorepo/
```

Recommended task sequence:

1. Architecture tracker and traceability checklist.
2. Workspace/package naming plan.
3. Root workspace scaffolding without behavior changes.
4. Import admin contracts.
5. Import admin server and client source.
6. Import admin migrations into root migration stream.
7. Add admin migration/storage tests.
8. Extract DB package.
9. Extract contracts package.
10. Extract docs-domain package.
11. Wire MCP HTTP to shared packages.
12. Wire docs worker to shared packages.
13. Wire admin server to shared packages.
14. Move runtime entrypoints into `apps/`.
15. Update Dockerfile and Compose.
16. Update README, deployment docs, and AGENTS.md.
17. Add import-boundary checks.
18. Final cleanup and traceability verification.

Each task must include:

- Goal.
- Scope.
- Out of scope.
- Files expected to change.
- Required tests.
- Acceptance criteria.
- Rollback or compatibility notes when relevant.

## 28. Definition Of Done

This architecture effort is done when the repository behaves as one cohesive product with clear internal boundaries:

- One Git repository.
- One dependency lockfile.
- One migration stream.
- One shared docs-domain implementation.
- One shared DB implementation.
- Separate app runtimes.
- Optional admin deployment.
- Passing tests and type-checks.
- Updated docs.
- No known duplicated source between admin and MCP for docs-domain behavior.

