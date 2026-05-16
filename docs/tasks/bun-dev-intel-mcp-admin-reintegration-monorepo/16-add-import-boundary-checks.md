# Task 16: Add Import-Boundary Checks

## Goal

Prevent future drift by enforcing app/package dependency boundaries in deterministic tests.

## Scope

- Add or update import-boundary tests.
- Check that packages do not import apps.
- Check that admin client does not import DB or server-only packages.
- Check that MCP HTTP does not import admin server/client.
- Check that docs-domain is not duplicated under admin paths.

## Out Of Scope

- Do not introduce a heavy lint stack unless explicitly justified.
- Do not refactor imports beyond what is required to satisfy the boundaries.

## Required Tests

```text
bun test tests/unit/http-import-boundary.test.ts
bun test tests/unit/deployment/admin-reintegration-monorepo.test.ts
bun run typecheck
```

## Acceptance Criteria

- Boundary tests fail on forbidden cross-app imports.
- Boundary tests pass on the final package graph.
- Temporary compatibility shims are either allowed explicitly or removed.

