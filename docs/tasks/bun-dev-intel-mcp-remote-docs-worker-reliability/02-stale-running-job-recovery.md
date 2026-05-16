# Task 02 - Recover Stale Running Jobs

## Goal

Automatically mark stale `running` refresh jobs as failed before claiming new queued jobs.

## Motivation

Worker crashes, container restarts, and earlier bugs can leave jobs in `running`. Later cycles ignore those jobs because they only claim `queued` work, so operators must currently repair the database manually.

## Scope

- Add runtime config for `DOCS_REFRESH_RUNNING_TIMEOUT_SECONDS`.
- Default timeout: `1800`.
- Validation: integer, minimum `60`, maximum `86400`.
- Add storage support or an equivalent worker-owned query to recover stale `running` jobs.
- Run recovery before claiming queued jobs.
- Bound each recovery pass.
- Include recovery stats in the worker cycle result.
- Document the new env variable in env example and deployment docs.

## Out Of Scope

- No automatic requeue in V1.
- No distributed lease table.
- No queue backend replacement.
- No admin MCP tool for recovery.

## Behavior Requirements

- Running jobs older than the timeout are marked `failed`.
- Fresh running jobs are left alone.
- Recovery writes a structured `last_error` with code, timeout age, and safe context.
- Recovery is bounded so a large stale backlog does not block a cycle indefinitely.
- The next worker cycle can continue processing queued jobs after recovery.

## Tests To Implement First

Add or update:

- `tests/unit/config/remote-docs-config.test.ts`
  - default running timeout is `1800`.
  - valid timeout parses.
  - invalid timeout fails without leaking secrets.

- `tests/integration/docs/refresh/docs-worker.test.ts`
  - stale `running` jobs older than timeout are marked failed before claiming queued jobs.
  - fresh `running` jobs are not recovered.
  - recovery count is included in cycle result.

- `tests/unit/deployment/docker-config.test.ts`
  - env example documents `DOCS_REFRESH_RUNNING_TIMEOUT_SECONDS`.

## Validation

- `bun test tests/unit/config/remote-docs-config.test.ts`
- `bun test tests/integration/docs/refresh/docs-worker.test.ts`
- `bun test tests/unit/deployment/docker-config.test.ts`
- `bun run typecheck`
- `bun run check`

## Acceptance Criteria

- Stale `running` jobs recover automatically without direct SQL edits.
- Config is validated and documented.
- Recovery does not affect fresh active jobs.

## Commit Guidance

Commit stale job recovery, config, docs, and focused tests only.

Suggested message:

```text
fix: recover stale running docs refresh jobs
```
