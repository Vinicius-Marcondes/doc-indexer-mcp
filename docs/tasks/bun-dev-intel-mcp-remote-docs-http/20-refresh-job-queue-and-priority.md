# Task 20 - Add Refresh Job Queue, Dedupe, And Priority Scoring

## Goal

Implement persistent refresh jobs with deduplication, priority scoring, retry metadata, and bounded queue behavior.

## Motivation

Scheduled and on-demand refresh should not run directly inside search requests. A durable queue lets the worker process refresh work safely and repeatedly without duplicate embedding jobs.

## Scope

- Add refresh job storage functions.
- Add dedupe rules by source, URL, job type, and pending/running status.
- Implement priority scoring inputs:
  - content age.
  - recent request count.
  - stale hit count.
  - low-confidence related searches.
  - recent failure penalty.
- Add queue bounds and per-source limits.
- Return enqueue result:
  - queued.
  - deduplicated.
  - skipped due to bounds.
  - rejected due to policy.

## Out Of Scope

- No worker loop.
- No actual refresh execution.
- No admin tool.

## Behavior Requirements

- Duplicate pending jobs are not inserted.
- Missing content can enqueue page job.
- Stale content can enqueue page job.
- Low-confidence search can enqueue source/index job or related page jobs where known.
- Recent failures reduce priority or delay retry.
- Disallowed URLs are rejected before job creation.

## Tests To Implement First

Add:

- `tests/integration/docs/refresh/refresh-queue.test.ts`
  - enqueues missing page job.
  - deduplicates same pending job.
  - allows new job after previous succeeds/fails according to policy.
  - rejects disallowed URL.
  - priority increases with age/access/stale hits.
  - recent failure lowers priority or delays job.
  - queue bounds are enforced.

## Validation

- Refresh queue tests.
- Storage tests.
- `bun run typecheck`
- `bun run check`

## Acceptance Criteria

- Refresh jobs are durable, deduplicated, and bounded.
- Priority inputs are explicit and test-covered.
- Search/page tools can enqueue refresh in later integration.

## Commit Guidance

Commit refresh queue and tests only.

Suggested message:

```text
feat: add bounded refresh job queue for docs
```
