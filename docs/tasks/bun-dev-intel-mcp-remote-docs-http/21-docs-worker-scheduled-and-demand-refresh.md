# Task 21 - Implement Docs Worker Scheduled And On-Demand Refresh

## Goal

Add the worker command that processes refresh jobs, supports scheduled refresh, and handles on-demand jobs created by search/page tools.

## Motivation

Ingestion must stay outside the HTTP request path. A worker keeps the remote MCP server responsive while allowing docs to refresh on a schedule and in response to low-confidence or stale access.

## Scope

- Add `src/docs-worker.ts`.
- Add worker service under `src/docs/refresh`.
- Process queued jobs:
  - source index refresh.
  - page refresh.
  - embedding refresh.
  - tombstone check jobs.
- Add scheduled refresh enqueue based on `DOCS_REFRESH_INTERVAL`.
- Respect concurrency and per-run limits.
- Mark jobs running/succeeded/failed with timestamps and errors.
- Integrate on-demand refresh enqueue from `search_docs` and `get_doc_page`.

## Out Of Scope

- No Docker yet.
- No admin MCP refresh tool.
- No model-based reranking.

## Behavior Requirements

- Worker command imports without side effects in tests.
- Worker processes jobs deterministically with mocked source/embedding providers.
- Worker does not expose HTTP routes.
- Search/page tools return immediately after enqueueing refresh.
- Failed jobs do not crash worker process.
- Repeated failures apply retry delay/penalty.

## Tests To Implement First

Add:

- `tests/integration/docs/refresh/docs-worker.test.ts`
  - worker processes queued page refresh job.
  - worker processes embedding job.
  - worker marks failed job with structured error.
  - worker respects max jobs per run.
  - worker respects concurrency setting.
  - scheduled refresh enqueues jobs when interval elapsed.
  - scheduled refresh does not enqueue when interval not elapsed.

Update:

- `tests/integration/tools/search-docs.test.ts`
  - low-confidence search enqueues refresh and returns promptly.

- `tests/integration/tools/get-doc-page.test.ts`
  - stale/missing page can enqueue refresh.

## Validation

- Worker tests.
- Refresh queue tests.
- Search/page tool tests.
- `bun run typecheck`
- `bun run check`

## Acceptance Criteria

- Refresh jobs are processed outside HTTP request handling.
- Scheduled refresh defaults to weekly and is configurable.
- On-demand refresh is bounded, deduped, and non-blocking.
- Worker command is ready for Docker task.

## Commit Guidance

Commit worker command, worker service, refresh integration, and tests only.

Suggested message:

```text
feat: process scheduled and on-demand docs refresh jobs
```
