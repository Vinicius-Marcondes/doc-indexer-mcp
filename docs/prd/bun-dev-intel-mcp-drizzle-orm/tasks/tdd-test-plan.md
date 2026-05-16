# TDD Test Plan: Drizzle ORM Implementation

Source status: the requested `bun-dev-intel-mcp-drizzle-orm.md` PRD was not present in this worktree or sibling Codex worktrees. This plan is derived from `docs/analysis/drizzle-orm-analysis.md` and the existing remote-docs migration/storage behavior.

## Goals

- Add Drizzle ORM without changing the existing `postgres.js` connection lifecycle.
- Model the current remote-docs and admin tables in a TypeScript Drizzle schema.
- Keep existing SQL migrations as the canonical deployed schema unless a later PRD provides a Drizzle migration cutover plan.
- Refactor low-risk `RemoteDocsStorage` CRUD paths to Drizzle query builder while preserving raw SQL for pgvector, full-text search, and refresh-job state-machine queries.
- Preserve all existing public package exports and compatibility wrappers.

## Meaningful TDD Coverage

1. Schema coverage test: fails until the Drizzle schema exports all current remote-docs and admin tables with the expected table names.
2. Schema naming test: fails until camelCase TypeScript properties map to existing snake_case database columns for docs sources, pages, chunks, embeddings, refresh jobs, retrieval events, and admin tables.
3. pgvector schema test: fails until the embeddings table models `embedding vector(1536)` and the HNSW cosine index through Drizzle schema metadata.
4. Client factory test: fails until `createDrizzleDatabase(sql)` wraps the existing `postgres.js` client and exposes the shared schema without replacing `SqlClient`.
5. Storage equivalence tests: keep the existing integration suite green for source/page/chunk/embedding/job/retrieval behavior after storage methods move to Drizzle.
6. Query-boundary tests: keep raw SQL tests around embedding validation, vector literal insertion, stale-job JSON casting, and complex refresh-job queries so Drizzle adoption does not hide database-specific behavior.
7. Typecheck gate: run `bun run typecheck` after TypeScript changes to catch schema/query drift.

## Implementation Order

1. Add the tests that assert the Drizzle schema/client boundary.
2. Add dependencies and the Drizzle schema/client exports.
3. Move simple docs storage CRUD methods to Drizzle.
4. Leave vector/full-text/hybrid retrieval and complex refresh-job locking queries as raw SQL.
5. Run targeted tests, then the full test and typecheck commands.
