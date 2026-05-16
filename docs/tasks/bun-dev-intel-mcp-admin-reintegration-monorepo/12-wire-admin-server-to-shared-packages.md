# Task 12: Wire Admin Server To Shared Packages

## Goal

Make the admin server consume canonical shared packages and remove temporary imports from root `src`.

## Scope

- Update admin runtime imports to packages.
- Use `packages/db` for storage.
- Use `packages/docs-domain` for retrieval, refresh queue, and search.
- Use `packages/admin-contracts` for API DTOs.

## Out Of Scope

- Do not change admin UI behavior.
- Do not add new admin routes.
- Do not move app entrypoints.

## Required Tests

```text
bun test tests/unit/admin tests/integration/admin tests/integration/tools/search-docs.test.ts
bun run typecheck
```

## Acceptance Criteria

- Admin server has no temporary imports from root `src/docs` or `src/tools`.
- Admin search and actions use shared domain implementations.
- Admin API tests pass.
- Viewer/admin authorization behavior remains unchanged.

