# Task 13: Move Runtime Entrypoints Into Apps

## Goal

Converge on the final app layout for MCP HTTP, docs worker, and admin console runtimes.

## Scope

- Add or move MCP HTTP entrypoint to `apps/mcp-http/src`.
- Add or move docs worker entrypoint to `apps/docs-worker/src`.
- Keep admin server entrypoint under `apps/admin-console/server/src`.
- Add compatibility wrappers for old root entrypoints when needed.
- Update scripts and tests.

## Out Of Scope

- Do not change runtime behavior.
- Do not update Docker unless required by test setup; Docker has a dedicated task.
- Do not remove compatibility wrappers until final cleanup.

## Required Tests

```text
bun test tests/integration/http tests/integration/mcp tests/integration/docs/refresh
bun run typecheck
```

## Acceptance Criteria

- App entrypoints exist under `apps/`.
- Existing commands have compatibility wrappers or documented replacements.
- Importing entrypoints remains side-effect safe where current tests require it.
- Runtime behavior is unchanged.

