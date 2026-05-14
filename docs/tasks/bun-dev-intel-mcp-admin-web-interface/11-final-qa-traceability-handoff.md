# Task 11: Final QA, traceability, and handoff

## Goal

Verify the complete admin web interface implementation and document traceability back to the PRD.

## Why

The admin console touches auth, database operations, indexing actions, and UI workflows. The final pass must prove the implementation is complete and does not regress existing MCP behavior.

## Scope

- Complete traceability checklist.
- Add or update README/deployment references.
- Run full local gates.
- Run browser smoke tests.
- Verify existing MCP HTTP and stdio behavior still works.
- Record skipped infrastructure tests with reasons.

## Out Of Scope

- No new features.
- No push or release automation.

## Required Tests

- `bun test`
- `bun run typecheck`
- `bun run check`
- admin client build
- admin server tests
- browser smoke tests
- Postgres-gated tests when `TEST_DATABASE_URL` is available

## Acceptance Criteria

- Traceability checklist marks every PRD requirement as done, deferred, or intentionally out of scope.
- Final docs describe how to run admin console separately from MCP HTTP.
- Existing remote docs HTTP tests still pass.
- Existing stdio/local behavior remains covered.
