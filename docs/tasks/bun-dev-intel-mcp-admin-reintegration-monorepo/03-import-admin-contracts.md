# Task 03: Import Admin Contracts

## Goal

Import the browser-safe admin API contract package into the target repo.

## Scope

- Add `packages/admin-contracts`.
- Import Zod schemas and TypeScript DTOs from the split admin console.
- Add or adapt admin contract tests.
- Ensure the package is safe for browser imports.

## Out Of Scope

- Do not import admin server or client source yet.
- Do not import copied docs-domain code from the split admin repo.
- Do not add admin migrations yet.

## Required Tests

```text
bun test tests/unit/admin/admin-api-contracts.test.ts tests/unit/deployment/admin-reintegration-monorepo.test.ts
bun run typecheck
```

If imported tests need a new location, update the command in this file and tracker.

## Acceptance Criteria

- `packages/admin-contracts` exists and is listed in workspaces.
- Admin contract tests pass.
- The package has no server-only or database imports.
- Existing MCP tests are not affected.

