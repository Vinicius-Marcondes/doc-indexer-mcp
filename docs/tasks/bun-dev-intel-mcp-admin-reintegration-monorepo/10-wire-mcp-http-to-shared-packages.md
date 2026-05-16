# Task 10: Wire MCP HTTP To Shared Packages

## Goal

Make the MCP HTTP runtime consume shared packages rather than root `src` internals.

## Scope

- Update MCP server registration and HTTP startup imports.
- Use shared config, contracts, docs-domain, and db packages.
- Preserve `/mcp`, `/healthz`, and `/readyz` behavior.
- Keep compatibility entrypoints if source paths have not moved yet.

## Out Of Scope

- Do not move the MCP HTTP entrypoint into `apps/` yet unless this task is explicitly expanded.
- Do not change MCP tool response contracts.
- Do not change authentication behavior.

## Required Tests

```text
bun test tests/integration/http tests/integration/mcp tests/e2e/remote-docs-http-flow.test.ts
bun run typecheck
```

## Acceptance Criteria

- MCP HTTP imports shared package APIs.
- Existing MCP tool/resource tests pass.
- Auth and body-limit behavior remains unchanged.
- No admin server imports enter MCP HTTP.

