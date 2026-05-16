# Task 02: Root Workspace Scaffold

## Goal

Make the target repository capable of hosting app and package workspaces without changing runtime behavior.

## Scope

- Update root `package.json` with workspace configuration.
- Add initial `apps/` and `packages/` folders if needed.
- Add package tsconfig baselines only where required.
- Keep existing MCP HTTP and docs worker commands working.
- Update scaffold/import-boundary tests that currently assert workspaces do not exist.

## Out Of Scope

- Do not move MCP HTTP code into `apps/mcp-http`.
- Do not import admin source.
- Do not change Docker commands.
- Do not change database migrations.

## Required Tests

```text
bun test tests/unit/scaffold.test.ts tests/unit/http-import-boundary.test.ts tests/unit/deployment/admin-reintegration-monorepo.test.ts
bun run typecheck
```

## Acceptance Criteria

- Root package declares workspaces.
- Existing `bun run dev`, `bun test`, and `bun run typecheck` remain valid.
- Tests no longer assert that admin workspace paths are permanently forbidden.
- No runtime behavior changes are included.

