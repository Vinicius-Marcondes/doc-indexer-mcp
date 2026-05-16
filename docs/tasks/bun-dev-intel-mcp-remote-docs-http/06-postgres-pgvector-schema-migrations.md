# Task 06 - Add Postgres And pgvector Schema Migrations

## Goal

Create the database schema needed for sources, pages, chunks, embeddings, refresh jobs, and retrieval telemetry.

## Motivation

Retrieval quality depends on durable, queryable documentation data. The schema must support source-pack expansion, vector search, exact search, freshness, refresh jobs, and embedding versioning from the start.

## Scope

- Add migration structure.
- Add migrations for:
  - `doc_sources`
  - `doc_pages`
  - `doc_chunks`
  - `doc_embeddings`
  - `doc_refresh_jobs`
  - `doc_retrieval_events`
- Enable or require `pgvector` extension.
- Add full-text search support for chunks.
- Add uniqueness constraints for source/page/chunk identity.
- Add embedding dimension/version metadata.

## Out Of Scope

- No repository/storage access layer yet.
- No ingestion pipeline.
- No retrieval queries beyond migration verification.

## Architecture Requirements

- Migrations must be deterministic and ordered.
- Schema must support future source IDs, not only Bun.
- Embeddings must be versioned by provider/model/dimensions.
- Search vectors must be indexed.
- Vector indexes may be added now or deferred with explicit migration notes if dataset size is too small.

## Tests To Implement First

Add:

- `tests/integration/storage/migrations.test.ts`
  - migrations run on test Postgres.
  - `pgvector` extension is available.
  - all expected tables exist.
  - required indexes/constraints exist.
  - vector dimension mismatch is rejected or prevented by schema/access policy.

If CI cannot provide Postgres yet, add a clearly skipped integration test gated by env and a unit test that validates migration files are present and ordered. Do not claim full acceptance until real Postgres tests exist.

## Validation

- Migration-focused tests.
- `bun run typecheck`
- `bun run check`

## Acceptance Criteria

- Schema is present and testable.
- `pgvector` availability is verified.
- Existing tests still pass.
- No product code writes data yet.

## Commit Guidance

Commit migrations and migration tests only.

Suggested message:

```text
feat: add remote docs Postgres pgvector schema
```
