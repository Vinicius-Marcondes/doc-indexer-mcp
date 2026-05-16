# Tracker: Remote Docs Worker Reliability And Idempotent Embeddings

Use this tracker as the implementation control plane for [the worker reliability PRD](../../prd/bun-dev-intel-mcp-remote-docs-worker-reliability.md).

Keep it short, current, and factual. Do not paste long logs, command output, or design debates here.

## Tracker Instructions

Before starting work:

1. Read [the PRD](../../prd/bun-dev-intel-mcp-remote-docs-worker-reliability.md).
2. Read this tracker.
3. Read only the task file for the next todo task.
4. Update `Current Task` with task ID, title, owner, status, started date, planned validation, and commit intent.
5. Add one short `Work Log` entry.

While working:

- Keep exactly one task `in_progress`.
- Write meaningful failing tests first.
- Keep implementation within the current task's stated scope.
- If scope changes, pause and update the PRD before continuing.
- If a blocker appears, record it and leave the task status as `blocked`.
- Keep test notes short: command name, pass/fail, and the important reason.

After finishing a task:

1. Mark the task `done` in `Task Status`.
2. Record focused tests and final gate results.
3. Add a completion `Work Log` entry.
4. Commit only that task's work with a descriptive commit message.
5. Clear or advance `Current Task`.

Commit message requirement:

- Mention the goal.
- Mention the affected files or areas.
- Mention why the change was needed.
- Do not bundle unrelated task work.

## Current Task

- Task ID: none
- Title: Complete
- Owner: Codex
- Status: done
- Started: n/a
- Planned validation: complete
- Commit intent: n/a
- Notes: All tasks complete. Local stdio remains owned by `bun-dev-intel-stdio-mcp`; a later reintegration brought the admin console back into this repository as an optional app.

## Task Status

| Task | Title | Status | Task File |
| --- | --- | --- | --- |
| 00 | Make embedding storage idempotent | done | [00](00-idempotent-embedding-storage.md) |
| 01 | Mark jobs failed when execution throws | done | [01](01-worker-exception-handling.md) |
| 02 | Recover stale running jobs | done | [02](02-stale-running-job-recovery.md) |
| 03 | Add source-level job exclusivity | done | [03](03-source-level-job-exclusivity.md) |
| 04 | Improve worker logs and deployment docs | done | [04](04-worker-logging-and-deployment-docs.md) |
| 05 | Final QA and traceability | done | [05](05-final-qa-traceability.md) |

## Work Log

| Date | Task | Status | Notes |
| --- | --- | --- | --- |
| 2026-05-14 | Planning | done | Split worker reliability PRD into scoped task files and initialized tracker. No implementation started. |
| 2026-05-14 | 00 | in_progress | Started idempotent embedding storage; planned storage, ingestion, typecheck, and check validation. |
| 2026-05-14 | 00 | done | Implemented idempotent embedding insert with existing-row compatibility validation. Validation passed; DB-backed tests skipped without `TEST_DATABASE_URL`. |
| 2026-05-14 | 01 | in_progress | Started per-job exception handling; planned worker refresh tests, typecheck, and check validation. |
| 2026-05-14 | 01 | done | Wrapped per-job execution exceptions into sanitized failed-job results and verified continuation after throws. Validation passed. |
| 2026-05-14 | 02 | in_progress | Started stale running job recovery; planned config, worker, deployment docs, typecheck, and check validation. |
| 2026-05-14 | 02 | done | Added timeout config, bounded stale running job recovery before claim, recovery stats, and env/deployment docs. Validation passed. |
| 2026-05-14 | 03 | in_progress | Started source-level exclusivity; planned worker refresh tests, typecheck, and check validation. |
| 2026-05-14 | 03 | done | Added source-level broad-job exclusivity and requeued skipped same-source jobs. Validation passed. |
| 2026-05-14 | 04 | in_progress | Started safe worker logging and deployment monitoring docs; planned worker, deployment docs, typecheck, and check validation. |
| 2026-05-14 | 04 | done | Added sanitized job failure and stale recovery logs plus deployment monitoring SQL. Validation passed. |
| 2026-05-14 | 05 | in_progress | Started final QA and traceability; planned checklist plus focused boundary checks and final gates. |
| 2026-05-14 | 05 | done | Added worker reliability traceability checklist. Focused checks and final gates `bun test`, `bun run typecheck`, and `bun run check` passed. |
