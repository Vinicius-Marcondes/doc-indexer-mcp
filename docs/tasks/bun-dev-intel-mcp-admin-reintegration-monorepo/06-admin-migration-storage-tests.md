# Task 06: Admin Migration And Storage Tests

## Goal

Prove admin auth, read-model, action, and audit storage work against the canonical target repo migrations.

## Scope

- Import or adapt admin storage integration tests.
- Point tests at the target repo migration runner.
- Cover admin users, sessions, audit events, read models, and action store operations.

## Out Of Scope

- Do not extract the DB package yet unless required for testability.
- Do not change admin product behavior.
- Do not add new admin UI features.

## Required Tests

```text
bun test tests/integration/admin
bun test tests/integration/storage/migrations.test.ts
bun run typecheck
```

## Acceptance Criteria

- Admin storage tests run from the target repo.
- Tests use canonical migrations.
- Session token hashes, audit writes, refresh job writes, and read models are covered.
- DB-gated tests skip clearly when `TEST_DATABASE_URL` is missing.

