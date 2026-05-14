# Task 13 - Store Ingested Pages, Chunks, And Embeddings

## Goal

Implement the ingestion pipeline that stores normalized pages, stable chunks, and embeddings in Postgres.

## Motivation

Discovery, chunking, and embeddings become useful only once they are persisted consistently. This task creates the write path that later retrieval and refresh jobs depend on.

## Scope

- Compose Bun docs discovery/normalization, chunking, storage, and embedding provider.
- Upsert pages by source/canonical URL.
- Replace chunks only when page content changes.
- Avoid re-embedding unchanged chunk hashes for the same provider/model/version.
- Store fetch/index timestamps and content hashes.
- Return ingestion summary with counts and warnings.

## Out Of Scope

- No scheduled worker loop.
- No search tools.
- No refresh queue yet, except direct ingestion calls.

## Architecture Requirements

- Keep orchestration under `src/docs/ingestion`.
- Use transactions for page/chunk/embedding writes where practical.
- Keep embedding provider injected.
- Use fake provider in tests.
- Never fetch non-allowlisted URLs.

## Tests To Implement First

Add:

- `tests/integration/docs/ingestion/ingestion-pipeline.test.ts`
  - stores source, page, chunks, and embeddings from mocked Bun docs.
  - second unchanged run does not duplicate chunks.
  - second unchanged run does not re-embed existing chunks.
  - changed page content updates page hash and chunk set.
  - provider failure records structured failure and does not corrupt page data.
  - disallowed URL is rejected before fetch.

## Validation

- Ingestion pipeline tests.
- Storage tests.
- Embedding provider tests.
- `bun run typecheck`
- `bun run check`

## Acceptance Criteria

- Bun docs can be ingested into Postgres using mocked official sources.
- Writes are idempotent for unchanged content.
- Embedding reuse is based on chunk hash and embedding version.
- Failures are structured and testable.

## Commit Guidance

Commit ingestion orchestration and tests only.

Suggested message:

```text
feat: store ingested docs pages chunks and embeddings
```
