# PRD: Bun Dev Intel MCP Drizzle ORM

## Status

Implemented from the available Drizzle analysis because this PRD file was missing from the worktree at task start.

## Objective

Adopt Drizzle ORM for the remote-docs database layer while preserving the existing Bun, `postgres.js`, Postgres, pgvector, and single migration stream architecture.

## Requirements

- Add `drizzle-orm` to the database package without replacing the existing `postgres.js` client lifecycle.
- Add a TypeScript Drizzle schema that models the current docs and admin tables from `migrations/remote-docs`.
- Keep camelCase TypeScript property names mapped to existing snake_case database columns.
- Model pgvector storage with `embedding vector(1536)` and the HNSW cosine index metadata.
- Expose a `createDrizzleDatabase(sql)` wrapper that shares the existing SQL client.
- Migrate low-risk `RemoteDocsStorage` CRUD paths to Drizzle query builder.
- Keep raw SQL for pgvector insertion, full-text/vector retrieval, and refresh-job locking/state-machine queries where SQL-specific behavior is clearer and already tested.
- Preserve existing public package exports and root compatibility wrappers.
- Keep existing SQL migrations as the canonical deployed schema for this implementation pass.

## Acceptance Criteria

- Drizzle schema/client unit tests cover table coverage, column naming, pgvector metadata, and client wrapping.
- Existing storage, refresh, retrieval, admin, HTTP, MCP, deployment, and boundary tests pass.
- `bun run typecheck` passes after TypeScript changes.
- Drizzle Kit config validates against the schema.
- README and AGENTS describe the updated database package responsibility.
