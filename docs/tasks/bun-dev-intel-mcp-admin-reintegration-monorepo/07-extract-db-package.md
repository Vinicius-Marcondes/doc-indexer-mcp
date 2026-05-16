# Task 07: Extract DB Package

## Goal

Move database client, migration runner, storage adapters, and DB test helpers into `packages/db`.

## Scope

- Create `packages/db`.
- Move or re-export Postgres client and migration runner.
- Move docs storage.
- Move admin auth/read-model/action storage when present.
- Update imports incrementally.
- Add compatibility re-exports from old paths if needed.

## Out Of Scope

- Do not change SQL behavior.
- Do not extract docs-domain logic.
- Do not move runtime entrypoints.

## Required Tests

```text
bun test tests/integration/storage tests/integration/admin
bun run typecheck
```

## Acceptance Criteria

- `packages/db` is the canonical owner of DB access.
- Root migrations are still loaded from `migrations/remote-docs/`.
- Existing storage tests pass.
- Temporary compatibility exports are documented.

