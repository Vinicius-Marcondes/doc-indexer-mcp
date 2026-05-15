# PRD: Remote Docs Worker Reliability And Idempotent Embeddings

## 1. Summary

Improve the Remote Docs Intelligence MCP worker so docs ingestion cannot leave refresh jobs permanently stuck in `running`, and repeated or overlapping ingestion cannot fail on duplicate embedding rows.

This PRD extends `docs/prd/bun-dev-intel-mcp-remote-docs-http.md`. It is documentation only. Implementation must happen in focused tasks after review.

## 2. Problem

During local Docker testing with an OpenAI-compatible Ollama embedding endpoint, the docs worker claimed refresh jobs and then exited with:

```text
bun-dev-intel-mcp docs worker failed: Docs worker failed to run.
```

The claimed jobs stayed in `doc_refresh_jobs.status = 'running'` with unchanged `updated_at`. Later worker cycles ignored them because the claim query only selects `queued` jobs.

The database also showed all currently stored chunks had embeddings, while broader ingestion jobs still failed. A manual ingestion run exposed a duplicate-key failure:

```text
duplicate key value violates unique constraint "doc_embeddings_chunk_provider_model_version_key"
```

The duplicate happens because ingestion checks whether an embedding exists, generates embeddings, and then inserts. Another job or concurrent worker path can insert the same `(chunk_id, provider, model, embedding_version)` before the insert completes.

## 3. Goals

- Make embedding writes idempotent for repeated or overlapping ingestion.
- Ensure every claimed refresh job reaches a terminal state: `succeeded` or `failed`.
- Recover stale `running` jobs created by worker crashes, container restarts, or unexpected exceptions.
- Reduce source-level overlap between broad `source_index` refresh and page-specific refresh jobs.
- Improve worker logs enough to identify the failed job, error code, and safe message without exposing secrets.
- Preserve the docs-only remote HTTP server boundary; stdio/local project analysis is owned by the split-out `bun-dev-intel-stdio-mcp` repository.
- Keep ingestion outside the HTTP request path.

## 4. Non-Goals

- Do not add a remote admin MCP refresh tool.
- Do not expose local project analysis over remote HTTP.
- Do not change the remote docs source allowlist.
- Do not change the pgvector embedding dimension model beyond existing `1536` schema compatibility.
- Do not introduce a separate queue system such as Redis or BullMQ.
- Do not perform broad crawler redesign.
- Do not delete or reset existing local Docker data as part of implementation.

## 5. Current Behavior

### 5.1 Embedding Writes

`RemoteDocsStorage.insertEmbedding()` inserts directly into `doc_embeddings`.

The table has:

```text
UNIQUE (chunk_id, provider, model, embedding_version)
```

If the row appears between `getEmbeddingForChunk()` and `insertEmbedding()`, Postgres throws a duplicate-key error.

### 5.2 Worker Failure

`DocsRefreshWorker.runOnce()` updates claimed jobs to `running`, calls `executeJob()`, and marks jobs `succeeded` or `failed` only when execution returns a structured result.

If an unexpected exception escapes from storage, ingestion, provider, or executor code, the worker startup path catches it at a higher level and returns a generic startup failure. The specific job remains `running`.

### 5.3 Stale Running Jobs

There is no lease, timeout, or recovery pass for jobs left in `running`.

### 5.4 Job Overlap

A broad `source_index` job and page-specific jobs can touch the same source and chunks. `DOCS_REFRESH_MAX_CONCURRENCY` limits concurrent claimed jobs but does not guarantee source-level exclusivity.

## 6. Requirements

### 6.1 Idempotent Embedding Insert

The storage layer must treat duplicate embedding insertion for the same `(chunk_id, provider, model, embedding_version)` as success when the existing row is compatible.

Required behavior:

- If no row exists, insert and return the new row.
- If a compatible row exists, return the existing row.
- If a row exists with incompatible dimensions or metadata, return a structured failure or throw a controlled validation error before corrupting data.
- Do not overwrite existing vector values for the same embedding version.

Preferred SQL strategy:

```sql
insert into doc_embeddings (...)
values (...)
on conflict (chunk_id, provider, model, embedding_version)
do nothing
returning ...
```

If no row is returned, fetch the existing row by the unique key and validate dimensions.

### 6.2 Worker Exception Handling

`DocsRefreshWorker.runOnce()` must handle unexpected per-job exceptions.

Required behavior:

- Wrap each job execution in `try/catch`.
- Convert thrown errors to sanitized structured errors.
- Mark the job `failed` with `last_error`.
- Continue processing other claimed jobs according to concurrency settings.
- The worker process should not exit with startup failure for a normal per-job failure.

The worker may still fail startup for true startup problems such as invalid config, missing database connectivity before claim, or migration absence.

### 6.3 Stale Running Job Recovery

Before claiming queued jobs, the worker must recover stale `running` jobs.

Required behavior:

- Add a configurable running-job timeout.
- Default timeout: 30 minutes.
- Mark stale `running` jobs as `failed` with a structured `last_error`.
- Include `attempt_count`, `started_at`, and timeout age in error details.
- Bound each recovery pass to avoid large updates.

Environment variable:

```text
DOCS_REFRESH_RUNNING_TIMEOUT_SECONDS=1800
```

Recovery should prefer marking failed over automatic requeue in V1. Requeue can create infinite loops when the underlying error persists.

### 6.4 Source-Level Exclusivity

The worker should avoid processing overlapping jobs for the same source in the same cycle when a broad source job is claimed.

Required behavior:

- If a `source_index` job is claimed for `source_id = 'bun'`, do not process other `bun` jobs in that same run.
- Page jobs for the same source should wait for a later cycle.
- Jobs for future different sources may run concurrently if source packs are independent.

This requirement reduces overlap but does not replace idempotent storage.

### 6.5 Logging

Worker logs must include safe failure details.

Required fields:

- job id
- source id
- job type
- status
- structured error code
- sanitized message

Logs must not include:

- bearer tokens
- raw authorization headers
- OpenAI or local provider API keys
- full embedding payloads
- full page content

Example:

```text
bun-dev-intel-mcp docs worker job failed id=32 source=bun type=page code=duplicate_embedding message="Embedding already exists for chunk/version."
```

## 7. Data And API Changes

### 7.1 Storage API

Keep the existing public method name:

```ts
insertEmbedding(input: InsertEmbeddingInput): Promise<DocEmbedding>
```

Change behavior to be idempotent. The caller should not need to special-case duplicate-key conflicts.

### 7.2 Refresh Storage API

Add a method to recover stale running jobs:

```ts
recoverStaleRunningRefreshJobs(input: {
  readonly now: string;
  readonly staleBefore: string;
  readonly limit: number;
  readonly lastError: string;
}): Promise<readonly RefreshJob[]>
```

Alternative: implement the recovery query inside the worker if adding a storage method creates too much surface area. A storage method is preferred for testability.

### 7.3 Config

Add parsing for:

```text
DOCS_REFRESH_RUNNING_TIMEOUT_SECONDS
```

Validation:

- integer
- minimum: `60`
- maximum: `86400`
- default: `1800`

### 7.4 Worker Result

Extend cycle result with optional recovery stats:

```ts
interface DocsRefreshWorkerCycleResult {
  readonly scheduled: ScheduledRefreshResult;
  readonly processed: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly recovered?: {
    readonly staleRunningFailed: number;
  };
}
```

## 8. Test Plan

### 8.1 Storage Tests

Add tests under `tests/integration/storage/docs-storage.test.ts` or a focused storage unit/integration test.

Cases:

- inserting the same embedding twice returns one stored row and no duplicate-key throw.
- second insert returns the existing row for the same unique key.
- incompatible dimensions are rejected before or during the idempotency path.

### 8.2 Worker Tests

Add tests under `tests/integration/docs/refresh/docs-worker.test.ts`.

Cases:

- executor throws unexpectedly; claimed job becomes `failed`.
- worker continues after one job throws when multiple jobs are claimed.
- stale `running` jobs older than timeout are marked failed before claiming queued jobs.
- fresh `running` jobs are not recovered.
- source-level exclusivity skips page jobs when a `source_index` job for the same source is claimed.

### 8.3 Config Tests

Add tests under `tests/unit/config/remote-docs-config.test.ts`.

Cases:

- default running timeout is `1800`.
- valid timeout parses.
- invalid timeout fails without leaking secrets.

### 8.4 Deployment Tests

Update `tests/unit/deployment/docker-config.test.ts` and docs tests if they validate env names.

Cases:

- `.env.example` documents `DOCS_REFRESH_RUNNING_TIMEOUT_SECONDS`.
- deployment docs explain running job recovery and the timeout.

## 9. Acceptance Criteria

- Duplicate embedding inserts no longer throw duplicate-key errors.
- A thrown exception during job execution marks the claimed job `failed`.
- Stale `running` jobs older than the configured timeout are automatically marked failed on the next worker cycle.
- Worker logs include safe job-level error details.
- `DOCS_REFRESH_RUNNING_TIMEOUT_SECONDS` is documented and validated.
- A broad `source_index` job does not run concurrently with page jobs for the same source in the same cycle.
- Existing remote docs-only HTTP partition remains unchanged. Local stdio tools are maintained in the split-out `bun-dev-intel-stdio-mcp` repository.
- Required validation passes:

```bash
bun test
bun run typecheck
bun run check
```

## 10. Operational Recovery After Implementation

After deployment, existing stuck jobs can be left for automatic recovery if they are older than the configured timeout. A manual recovery command should remain documented for emergencies, but normal operation should not require direct SQL edits.

Operators should monitor:

- `doc_refresh_jobs` terminal status counts.
- stale `running` job count.
- `doc_pages`, `doc_chunks`, and `doc_embeddings` growth.
- worker logs for structured job failure codes.

## 11. Risks

- Marking stale jobs failed too aggressively can fail long-running source refreshes. The default timeout must account for local embedding latency.
- Returning existing embeddings on conflict can hide real model/version mistakes if validation is too loose.
- Source-level exclusivity can reduce throughput, but it is acceptable for V1 reliability.
- Existing tests that assume plain insert failure may need to be updated to the new idempotent behavior.

## 12. Suggested Task Breakdown

Implementation is tracked in [the worker reliability tracker](../tasks/bun-dev-intel-mcp-remote-docs-worker-reliability/TRACKER.md).

1. [Make embedding storage idempotent](../tasks/bun-dev-intel-mcp-remote-docs-worker-reliability/00-idempotent-embedding-storage.md).
2. [Mark jobs failed when execution throws](../tasks/bun-dev-intel-mcp-remote-docs-worker-reliability/01-worker-exception-handling.md).
3. [Recover stale running jobs](../tasks/bun-dev-intel-mcp-remote-docs-worker-reliability/02-stale-running-job-recovery.md).
4. [Add source-level job exclusivity](../tasks/bun-dev-intel-mcp-remote-docs-worker-reliability/03-source-level-job-exclusivity.md).
5. [Improve worker logs and deployment docs](../tasks/bun-dev-intel-mcp-remote-docs-worker-reliability/04-worker-logging-and-deployment-docs.md).
6. [Final QA and traceability](../tasks/bun-dev-intel-mcp-remote-docs-worker-reliability/05-final-qa-traceability.md).
