# Task 00 - Make Embedding Storage Idempotent

## Goal

Make `RemoteDocsStorage.insertEmbedding()` safe to call repeatedly for the same `(chunk_id, provider, model, embedding_version)`.

## Motivation

Docs ingestion can overlap or retry after an embedding existence check. A duplicate insert currently throws on `doc_embeddings_chunk_provider_model_version_key`, which can abort the worker and leave claimed refresh jobs stuck in `running`.

## Scope

- Update the storage behavior for `insertEmbedding`.
- Keep the existing public method name and return type.
- Use the existing unique key to deduplicate writes.
- Return the newly inserted row when the embedding is new.
- Return the existing row when the embedding already exists and is compatible.
- Validate dimensions before inserting and after fetching an existing row.

## Out Of Scope

- No worker exception handling.
- No stale running job recovery.
- No queue selection or concurrency changes.
- No schema dimension changes.
- No migration rewrite unless the current schema prevents idempotency.

## Behavior Requirements

- Duplicate embedding insertion for the same chunk/provider/model/version must not throw.
- Existing vector values for a given embedding version must not be overwritten.
- Incompatible dimensions must still fail safely.
- The ingestion pipeline should not need duplicate-key special cases.

## Tests To Implement First

Add or update:

- `tests/integration/storage/docs-storage.test.ts`
  - inserting the same embedding twice returns one stored row and no duplicate-key throw.
  - second insert returns the existing embedding id for the same unique key.
  - incompatible dimensions are rejected before the idempotency path can corrupt data.

If `TEST_DATABASE_URL` is required for the duplicate-key path, keep the deterministic dimension validation test in the default suite and gate only the real Postgres case.

## Validation

- `bun test tests/integration/storage/docs-storage.test.ts`
- `bun test tests/integration/docs/ingestion/ingestion-pipeline.test.ts`
- `bun run typecheck`
- `bun run check`

## Acceptance Criteria

- Repeated embedding writes are idempotent.
- No duplicate-key exception is thrown for compatible existing embeddings.
- Existing stdio/local project analysis behavior is unchanged.
- Remote HTTP remains docs-only.

## Commit Guidance

Commit idempotent embedding storage and focused tests only.

Suggested message:

```text
fix: make docs embedding storage idempotent
```
