# Task 01 - Mark Jobs Failed When Execution Throws

## Goal

Ensure unexpected per-job exceptions cannot leave claimed refresh jobs stuck in `running`.

## Motivation

The worker currently marks jobs failed when executors return structured failures. If storage, ingestion, provider, or executor code throws unexpectedly, the worker can exit through the startup wrapper and leave the claimed job in `running`.

## Scope

- Update `DocsRefreshWorker.runOnce()` or the per-job execution path.
- Wrap each claimed job execution in `try/catch`.
- Convert thrown errors into sanitized structured errors.
- Mark the affected job `failed` with `last_error`.
- Continue processing other claimed jobs when possible.
- Preserve existing behavior for structured `{ ok: false }` executor failures.

## Out Of Scope

- No stale running job recovery.
- No source-level exclusivity.
- No storage idempotency changes.
- No process supervisor or Compose changes.

## Behavior Requirements

- A thrown exception from `executeJob()` must mark that job `failed`.
- The worker cycle should complete and report the failure count.
- Other jobs claimed in the same cycle should still be handled according to concurrency settings.
- `last_error` must not include stack traces, secrets, full page content, or embedding payloads.

## Tests To Implement First

Add or update:

- `tests/integration/docs/refresh/docs-worker.test.ts`
  - executor throws unexpectedly and claimed job becomes `failed`.
  - thrown error is recorded as a structured sanitized `last_error`.
  - worker continues after one job throws when multiple jobs are claimed.
  - existing structured failure behavior still marks failed.

## Validation

- `bun test tests/integration/docs/refresh/docs-worker.test.ts`
- `bun run typecheck`
- `bun run check`

## Acceptance Criteria

- No per-job exception can leave the job `running` during that worker cycle.
- Worker process does not report a startup failure for ordinary per-job failures.
- Failure details remain safe for logs and database storage.

## Commit Guidance

Commit worker exception handling and focused tests only.

Suggested message:

```text
fix: fail docs refresh jobs on thrown execution errors
```
