# Admin Reintegration Traceability Checklist

| Requirement | Implementation | Tests | Status |
|---|---|---|---|
| Single Git repository | Root Bun workspace with `apps/*` and `packages/*` | `tests/unit/scaffold.test.ts` | done |
| One migration stream | `migrations/remote-docs` | `tests/integration/storage/migrations.test.ts` | done |
| Shared docs-domain implementation | `packages/docs-domain` facades and runtime imports | `tests/unit/import-boundaries.test.ts` | done |
| Separate runtime apps | `apps/mcp-http`, `apps/docs-worker`, `apps/admin-console/*` | `tests/unit/app-entrypoints.test.ts` | done |
