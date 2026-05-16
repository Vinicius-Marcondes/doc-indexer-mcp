# Admin Reintegration Monorepo Traceability Checklist

This checklist maps the PRD requirements to implementation areas and deterministic tests. Keep statuses current as tasks complete.

| PRD requirement | Implementation file(s) | Test file(s) | Status |
| --- | --- | --- | --- |
| Single Git repository | `package.json`, `apps/`, `packages/`, imported admin source | `tests/unit/deployment/admin-reintegration-monorepo.test.ts` | done |
| One migration stream | `migrations/remote-docs/`, `packages/db/src` | `tests/integration/storage/migrations.test.ts`, `tests/integration/admin` | done |
| Shared docs-domain implementation | `packages/docs-domain/src`, transitional `src/docs/*` compatibility source | docs domain unit/integration tests, `tests/unit/import-boundaries.test.ts` | done |
| Shared DB implementation | `packages/db/src`, compatibility `src/docs/storage/*` re-exports | `tests/integration/storage`, admin storage tests | done |
| Shared contracts | `packages/contracts/src`, `packages/admin-contracts/src`, compatibility `src/shared/*` re-exports | contract tests, admin contract tests, type-check | done |
| Separate MCP HTTP app | `apps/mcp-http/src`, compatibility `src/http.ts` | `tests/integration/http`, `tests/integration/mcp`, `tests/e2e/remote-docs-http-flow.test.ts` | done |
| Separate docs worker app | `apps/docs-worker/src`, compatibility `src/docs-worker.ts` | `tests/integration/docs/refresh`, `tests/unit/docs-worker-import-boundary.test.ts` | done |
| Optional admin console app | `apps/admin-console/server`, `apps/admin-console/client` | `tests/unit/admin`, `tests/integration/admin`, `bun run build:admin` | done |
| Admin auth and audit tables in canonical migrations | `migrations/remote-docs/0002_admin_auth_schema.sql`, `0003_admin_audit_events.sql` | `tests/integration/storage/migrations.test.ts`, `tests/integration/admin` | done |
| Admin client served by admin server | `apps/admin-console/server/src/app.ts`, `apps/admin-console/client/dist` | admin server static asset tests, `bun run build:admin` | done |
| Docker and Compose cover all services | `Dockerfile`, `docker-compose.yml`, `.env.example` | `tests/unit/deployment/docker-config.test.ts`, `docker compose config`, `docker compose --profile admin config` | done |
| No cross-app imports after extraction | app and package imports | `tests/unit/import-boundaries.test.ts`, app-specific boundary tests | done |
| Backward compatible MCP behavior | root compatibility entrypoints and moved apps | HTTP/MCP/e2e tests, `tests/unit/app-entrypoints.test.ts` | done |
| Documentation updated | `README.md`, `docs/deployment`, `AGENTS.md` | deployment documentation tests | done |

## Tracked Compatibility Shims

The following compatibility shims remain intentionally because existing tests, docs, or public commands still reference them:

- `src/http.ts` and `src/docs-worker.ts` are thin wrappers around `apps/mcp-http/src/index.ts` and `apps/docs-worker/src/index.ts`.
- `src/docs/storage/database.ts` and `src/docs/storage/docs-storage.ts` re-export `packages/db` for legacy root docs-domain imports and older tests.
- `src/shared/contracts.ts` and `src/shared/errors.ts` re-export `packages/contracts` for legacy root resources/tools.
- `packages/docs-domain/src/**` currently exposes package APIs through facade files while root `src/docs/*` remains the transitional implementation source. New app code imports the package APIs; future cleanup can move the implementation files into the package in a dedicated move-only pass.

## Completion Rules

- Mark a row `done` only when the implementation files exist and the listed deterministic tests pass.
- Mark a row `blocked` only with a short reason and the task that exposed the blocker.
- Do not remove rows without updating the PRD.
