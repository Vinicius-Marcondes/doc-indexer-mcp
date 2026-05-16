# Task 04: Import Admin Server And Client

## Goal

Bring the admin server and React client source into the target repo while preserving current admin behavior.

## Scope

- Add `apps/admin-console/server`.
- Add `apps/admin-console/client`.
- Import admin API, auth, read-model, action, runtime, and client source.
- Import focused admin tests.
- Temporarily allow admin server imports from existing `src/docs` modules until shared packages are extracted.

## Out Of Scope

- Do not copy `admin-console/src/docs` into the target repo.
- Do not duplicate docs-domain logic.
- Do not move existing MCP runtime entrypoints.
- Do not update Docker yet.

## Required Tests

```text
bun test tests/unit/admin tests/integration/admin
bun run admin:client:build
bun run typecheck
```

## Acceptance Criteria

- Admin server and client source live under `apps/admin-console`.
- Admin tests are imported and pass or are documented as gated for missing DB env.
- Admin client builds from the target repo.
- Admin runtime uses the target repo's existing docs modules, not copied split-repo docs modules.

