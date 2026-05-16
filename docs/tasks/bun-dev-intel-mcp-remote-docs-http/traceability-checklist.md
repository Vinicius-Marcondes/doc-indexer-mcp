# Remote Docs HTTP Traceability Checklist

| PRD requirement | Implementation file(s) | Test file(s) | Status |
|---|---|---|---|
| Streamable HTTP MCP endpoint | `apps/mcp-http/src/index.ts`, `src/http/app.ts`, `src/http/mcp.ts` | `tests/integration/mcp/streamable-http-entrypoint.test.ts`, `tests/e2e/remote-docs-http-flow.test.ts` | done |
| Bearer token authentication | `src/http/app.ts`, `src/config/remote-docs-config.ts` | `tests/integration/http/hono-app.test.ts` | done |
| Docs-only remote capabilities | `src/http/mcp.ts`, `src/tools/*`, `src/resources/*` | `tests/unit/http-import-boundary.test.ts`, `tests/integration/mcp/server-registration.test.ts` | done |
| Official Bun source policy | `src/docs/sources/bun-source-pack.ts`, `src/sources/allowlist.ts` | `tests/unit/docs/sources/bun-source-pack.test.ts`, `tests/unit/sources/allowlist.test.ts` | done |
| Postgres and pgvector storage | `migrations/remote-docs`, `packages/db/src` | `tests/integration/storage/migrations.test.ts`, `tests/integration/storage/docs-storage.test.ts` | done |
| Hybrid keyword and semantic retrieval | `src/docs/retrieval/*` | `tests/integration/docs/retrieval/hybrid-retrieval.test.ts` | done |
| Documentation page and chunk retrieval | `src/resources/docs-resources.ts`, `src/tools/get-doc-page.ts` | `tests/integration/resources/docs-resources.test.ts`, `tests/integration/tools/get-doc-page.test.ts` | done |
| Scheduled and on-demand refresh | `apps/docs-worker/src/index.ts`, `src/docs/refresh/*` | `tests/integration/docs/refresh/docs-worker.test.ts`, `tests/integration/docs/refresh/refresh-queue.test.ts` | done |
| Docker deployment | `Dockerfile`, `docker-compose.yml`, `docs/deployment/remote-docs-http.md` | `tests/unit/deployment/docker-config.test.ts` | done |
| Remote HTTP excludes local project analysis | `apps/mcp-http`, `src/http`, `src/tools`, `src/resources` | `tests/unit/http-import-boundary.test.ts` | done |
