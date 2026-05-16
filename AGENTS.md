# AGENTS.md

## 1. Overview

`bun-dev-intel-remote-docs-mcp` is a Bun workspace monorepo for a remote docs MCP HTTP service, a docs refresh worker, an optional admin console, and shared database/domain/contracts packages. The codebase keeps deployment processes separate while sharing one source tree, one remote-docs schema, and one migration stream.

## 2. Folder Structure

- `apps`: deployable/runtime app boundaries.
  - `apps/mcp-http`: Streamable HTTP MCP runtime for `/mcp`, `/healthz`, and `/readyz`; adapts docs-domain services into MCP tools and resources.
  - `apps/docs-worker`: scheduled and on-demand docs refresh worker; handles stale job recovery, source exclusivity, ingestion, embeddings, and safe operational logging.
  - `apps/admin-console/server`: Hono admin API and static asset host; uses shared admin contracts, database access, docs-domain services, auth stores, read models, and bounded action services.
  - `apps/admin-console/client`: React/Vite admin UI; consumes only browser-safe admin contracts and must not import database, MCP transport, secrets, or server-only modules.
- `packages`: shared workspace APIs used by apps.
  - `packages/contracts`: docs/MCP-adjacent DTOs, Zod schemas, and structured errors.
  - `packages/admin-contracts`: browser-safe admin API DTOs and schemas shared by admin server/client.
  - `packages/db`: Postgres client, migration runner, docs storage, row mappers, and database-facing types.
  - `packages/docs-domain`: shared docs-domain API surface for source policy, source packs, ingestion, embeddings, retrieval, refresh primitives, and docs tool services; many exports still facade root `src/docs` and `src/tools` implementation during the migration.
- `src`: transitional compatibility and remaining root implementation surface. Root `src/http.ts` and `src/docs-worker.ts` wrap app entrypoints; `src/server.ts`, `src/http`, `src/resources`, `src/sources`, `src/cache`, and much of `src/docs/**` still back MCP resources and docs-domain facade exports; `src/docs/storage/*` and `src/shared/*` re-export package APIs for older imports.
- `migrations/remote-docs`: canonical schema stream for MCP HTTP, docs worker, and admin console, including admin auth/audit tables.
- `tests`: unit, integration, e2e, live, deployment, and boundary tests; dependency-direction tests protect app/package layering.
- `docs`: deployment notes under `docs/deployment`; PRDs, task trackers, traceability checklists, and implementation handoff material under `docs/prd/<initiative>/tasks`.
- `Dockerfile`, `docker-compose.yml`, `.env.example`: one-repo deployment scaffolding for MCP HTTP, docs worker, optional admin console, and Postgres/pgvector.

## 3. Working Agreements

- Never read inside `node_modules`.
- Before any git command, read the git rules under `docs/`; if no dedicated `docs/git*` file exists, report that gap before push or release work.
- Never run `git push origin master`.
- Respond in the user's preferred language; keep technical terms in English and never translate code blocks.
- Build context before editing by checking related usages, flows, package boundaries, migrations, tests, and docs that might be affected.
- Fix the underlying cause, not only the visible symptom; apply the narrowest complete change that preserves behavior across MCP, worker, admin, and shared packages.
- Preserve dependency direction: apps may depend on packages; packages must not depend on apps; MCP HTTP and admin server must not import each other.
- Keep admin client code browser-safe. Do not expose database access, MCP bearer tokens, OpenAI keys, bootstrap passwords, or server-only package exports to the frontend bundle.
- Treat `migrations/remote-docs` as the single schema stream. Admin, MCP, and worker changes that need schema support must share migrations and storage tests.
- Prefer workspace package APIs over root compatibility paths for new app code. Keep compatibility wrappers only when they preserve existing commands or imports during incremental migration.
- Use shared contracts and Zod schemas at API boundaries; keep database row shapes private to storage layers and map them to camelCase DTOs.
- Keep source policy checks centralized in source packs/registries and enforce them before fetching, storing, queueing refresh work, or returning source-backed results.
- Preserve dependency injection for `sql`, `now`, fetch implementations, stores, queues, providers, loggers, and registries so tests stay deterministic and offline by default.
- When a task or PRD changes behavior, boundaries, migrations, deployment config, or admin contracts, write meaningful failing tests first; otherwise ask before introducing new test suites, lint, or formatter setup.
- Run `bun run typecheck` after TypeScript code changes, and report any relevant behavior/API compatibility risks.
- Update PRDs, `docs/prd/<initiative>/tasks` trackers/traceability, README, deployment docs, and AGENTS.md when behavior, app commands, or architecture boundaries change.
- New functions and modules should be small, single-purpose, and colocated near related code; external dependencies require a clear need and a short explanation.
