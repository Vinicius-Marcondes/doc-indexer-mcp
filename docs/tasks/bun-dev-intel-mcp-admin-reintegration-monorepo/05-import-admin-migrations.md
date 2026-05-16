# Task 05: Import Admin Migrations

## Goal

Move admin schema ownership into the canonical root migration stream.

## Scope

- Add admin auth migration to `migrations/remote-docs/`.
- Add admin audit migration to `migrations/remote-docs/`.
- Preserve table names, constraints, and indexes from the split admin implementation.
- Update migration ordering tests.

## Out Of Scope

- Do not change existing docs table semantics.
- Do not add destructive migrations.
- Do not rewrite the migration runner unless needed by tests.

## Required Tests

```text
bun test tests/integration/storage/migrations.test.ts
bun run typecheck
```

## Acceptance Criteria

- Admin tables are declared in root migrations.
- Migration ordering is deterministic.
- Existing docs migration assertions still pass.
- Repeated migrations remain safe where current migration style supports idempotency.

