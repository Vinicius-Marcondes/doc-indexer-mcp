# Task 11: Wire Docs Worker To Shared Packages

## Goal

Make the docs worker runtime consume shared packages rather than root `src` internals.

## Scope

- Update docs worker imports.
- Use shared config, docs-domain, and db packages.
- Preserve stale recovery, source-level exclusivity, refresh queue bounds, and worker logging behavior.

## Out Of Scope

- Do not move the worker entrypoint into `apps/` yet unless this task is explicitly expanded.
- Do not change refresh policy.
- Do not add new queue infrastructure.

## Required Tests

```text
bun test tests/integration/docs/refresh
bun run typecheck
```

## Acceptance Criteria

- Worker imports shared package APIs.
- Worker tests pass.
- Existing scheduled and on-demand refresh behavior remains compatible.
- Worker has no admin UI or MCP transport dependencies.

