# Migration Runner Implementation Tracker

## Status

- Status: Implemented
- Source PRD: `docs/prd/bun-dev-intel-mcp-migration-runner/bun-dev-intel-mcp-migration-runner.md`

## Task Plan

- [x] Add `0004_schema_migrations_table.sql` with the minimal tracking table.
- [x] Update `packages/db/src/database.ts` to acquire the advisory lock, bootstrap tracking, skip applied migrations, and record each pending migration transactionally.
- [x] Add runner tests for first run, second run, old-runner backfill, rollback on failure, and missing bootstrap migration.
- [x] Update migration integration expectations for the new table.
- [x] Update README migration docs to describe forward-only tracked migrations.
- [x] Run full verification.

## Acceptance Trace

- Tracking DDL: `migrations/remote-docs/0004_schema_migrations_table.sql`.
- Runner implementation: `packages/db/src/database.ts`.
- Behavioral coverage: `tests/unit/storage/migration-runner.test.ts`.
- Schema coverage: `tests/integration/storage/migrations.test.ts`.
- Operator docs: `README.md`.
