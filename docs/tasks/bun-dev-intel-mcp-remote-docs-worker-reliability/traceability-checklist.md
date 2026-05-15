# Remote Docs Worker Reliability Traceability Checklist

This checklist maps the worker reliability PRD requirements to implementation files and deterministic tests.

| PRD requirement | Implementation file(s) | Test file(s) | Status |
| --- | --- | --- | --- |
| Idempotent embedding insert | `src/docs/storage/docs-storage.ts` | `tests/integration/storage/docs-storage.test.ts`, `tests/integration/docs/ingestion/ingestion-pipeline.test.ts` | done |
| Per-job exception handling | `src/docs/refresh/docs-worker.ts` | `tests/integration/docs/refresh/docs-worker.test.ts` | done |
| Stale running job recovery | `src/docs/refresh/docs-worker.ts`, `src/docs/storage/docs-storage.ts`, `src/docs-worker.ts` | `tests/integration/docs/refresh/docs-worker.test.ts` | done |
| Running timeout configuration | `src/config/remote-docs-config.ts`, `.env.example`, `docs/deployment/remote-docs-http.md` | `tests/unit/config/remote-docs-config.test.ts`, `tests/unit/deployment/docker-config.test.ts` | done |
| Source-level job exclusivity | `src/docs/refresh/docs-worker.ts` | `tests/integration/docs/refresh/docs-worker.test.ts` | done |
| Safe worker failure logs | `src/docs/refresh/docs-worker.ts`, `src/docs-worker.ts`, `docs/deployment/remote-docs-http.md` | `tests/integration/docs/refresh/docs-worker.test.ts`, `tests/unit/deployment/remote-docs-handoff.test.ts` | done |
| Deployment monitoring and recovery docs | `.env.example`, `docs/deployment/remote-docs-http.md` | `tests/unit/deployment/docker-config.test.ts`, `tests/unit/deployment/remote-docs-handoff.test.ts` | done |
| Remote HTTP remains docs-only | `src/http.ts`, `src/http/mcp.ts`, `src/server.ts` | `tests/integration/mcp/streamable-http-entrypoint.test.ts`, `tests/integration/mcp/server-registration.test.ts` | done |
| Split-out sibling projects | `bun-dev-intel-stdio-mcp`, `bun-dev-intel-admin-console` | `tests/unit/http-import-boundary.test.ts`; sibling focused validation run during split | done |
| Final quality gates | `package.json`, `tsconfig.json` | `bun test`, `bun run typecheck`, `bun run check` | done |
