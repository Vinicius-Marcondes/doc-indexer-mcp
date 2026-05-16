# Remote Docs Worker Reliability Traceability Checklist

| PRD requirement | Implementation file(s) | Test file(s) | Status |
|---|---|---|---|
| Idempotent embedding insert | `packages/db/src/docs-storage.ts` | `tests/integration/storage/docs-storage.test.ts` | done |
| Per-job exception handling | `src/docs/refresh/docs-worker.ts` | `tests/integration/docs/refresh/docs-worker.test.ts` | done |
| Stale running job recovery | `src/docs/refresh/docs-worker.ts`, `packages/db/src/docs-storage.ts` | `tests/integration/docs/refresh/docs-worker.test.ts` | done |
| Source-level job exclusivity | `src/docs/refresh/docs-worker.ts` | `tests/integration/docs/refresh/docs-worker.test.ts` | done |
| Safe worker failure logs | `src/docs/refresh/docs-worker.ts` | `tests/integration/docs/refresh/docs-worker.test.ts` | done |
| Running timeout configuration | `src/config/remote-docs-config.ts` | `tests/unit/config/remote-docs-config.test.ts` | done |
| Remote HTTP remains docs-only | `apps/mcp-http/src/index.ts`, `src/http/mcp.ts` | `tests/integration/mcp/streamable-http-entrypoint.test.ts`, `tests/unit/http-import-boundary.test.ts` | done |
| Admin console remains a separate optional process | `apps/admin-console/server/src/index.ts`, `docker-compose.yml` | `tests/unit/deployment/docker-config.test.ts` | done |
