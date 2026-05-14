# Task 07 - Add Database Access Layer And Test Harness

## Goal

Provide typed database access helpers for docs storage and a deterministic test harness for Postgres-backed integration tests.

## Motivation

Later ingestion, retrieval, and refresh logic should not embed ad hoc SQL throughout tool handlers. A small storage layer keeps behavior testable and limits database coupling.

## Scope

- Add database connection factory.
- Add migration runner wrapper if not already present.
- Add repositories or storage modules for:
  - sources.
  - pages.
  - chunks.
  - embeddings.
  - refresh jobs.
  - retrieval events.
- Add test helpers for isolated DB setup/cleanup.

## Out Of Scope

- No crawling.
- No embedding provider.
- No retrieval ranking logic.
- No Hono route changes except readiness if needed.

## Architecture Requirements

- Keep SQL access under `src/docs/storage`.
- Keep business logic outside storage modules.
- Use transactions for multi-row write operations.
- Keep raw SQL parameterized.
- Never log database credentials.

## Tests To Implement First

Add:

- `tests/integration/storage/docs-storage.test.ts`
  - insert/read source.
  - upsert page by source and canonical URL.
  - insert chunks linked to page.
  - insert embedding linked to chunk.
  - reject embedding with wrong dimensions.
  - record retrieval event with query hash.
  - cleanup leaves tests isolated.

Update readiness tests:

- ready check fails when DB check fails.
- ready check passes with mocked DB check.

## Validation

- Storage tests.
- Hono readiness tests.
- `bun run typecheck`
- `bun run check`

## Acceptance Criteria

- Later tasks can persist and read docs data through typed storage APIs.
- Tests can run against isolated database state.
- SQL is parameterized and contained.

## Commit Guidance

Commit storage access and DB test harness only.

Suggested message:

```text
feat: add typed storage access for remote docs database
```
