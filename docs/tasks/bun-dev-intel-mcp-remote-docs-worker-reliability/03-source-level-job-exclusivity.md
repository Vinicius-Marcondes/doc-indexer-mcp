# Task 03 - Add Source-Level Job Exclusivity

## Goal

Avoid processing overlapping jobs for the same source in the same worker cycle when a broad `source_index` job is claimed.

## Motivation

A `source_index` job can touch many pages and chunks. Running page-specific jobs for the same source concurrently increases duplicate-write races and unnecessary provider work. Storage must still be idempotent, but the worker should reduce avoidable overlap.

## Scope

- Adjust worker job selection after claim or before execution.
- If a `source_index` job is claimed for a source, process only that broad job for that source in the cycle.
- Leave skipped same-source jobs queued or return them to queued status without losing priority.
- Allow future different-source jobs to run when they do not overlap.
- Keep existing max jobs and concurrency behavior for non-overlapping jobs.

## Out Of Scope

- No new queue backend.
- No distributed locks.
- No global single-worker requirement.
- No source-pack additions.

## Behavior Requirements

- A claimed `source_index` job for `bun` excludes same-cycle `bun` page, embedding, and tombstone jobs.
- Excluded jobs must not be left in `running`.
- Excluded jobs should be available to process in a later cycle.
- The behavior must be deterministic in tests.

## Tests To Implement First

Add or update:

- `tests/integration/docs/refresh/docs-worker.test.ts`
  - source-level exclusivity skips page jobs when a `source_index` job for the same source is claimed.
  - skipped same-source jobs are returned to or remain in `queued`.
  - jobs for another source can still run if a test registry includes another source.
  - normal page-only cycles still respect concurrency.

## Validation

- `bun test tests/integration/docs/refresh/docs-worker.test.ts`
- `bun run typecheck`
- `bun run check`

## Acceptance Criteria

- Broad source jobs do not overlap same-source page jobs in one cycle.
- No excluded job remains stuck in `running`.
- Existing refresh queue dedupe and priority behavior remains intact.

## Commit Guidance

Commit source-level worker exclusivity and focused tests only.

Suggested message:

```text
fix: avoid overlapping docs refresh jobs per source
```
