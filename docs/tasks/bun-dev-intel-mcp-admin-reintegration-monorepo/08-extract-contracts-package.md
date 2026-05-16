# Task 08: Extract Contracts Package

## Goal

Move shared docs and MCP-adjacent response contracts into `packages/contracts`.

## Scope

- Create `packages/contracts`.
- Move shared docs response schemas and structured error contracts.
- Update MCP tools/resources and admin search where safe.
- Keep browser-safe contract boundaries separate from server-only code.

## Out Of Scope

- Do not merge admin-contracts into contracts unless the task is updated.
- Do not change public response shapes.
- Do not move DB row types into contracts.

## Required Tests

```text
bun test tests/unit/contracts.test.ts tests/unit/errors.test.ts tests/integration/tools
bun run typecheck
```

## Acceptance Criteria

- `packages/contracts` owns shared docs contracts.
- Public DTO behavior is unchanged.
- Contracts package has no DB or app imports.
- Type-check passes with updated imports.

