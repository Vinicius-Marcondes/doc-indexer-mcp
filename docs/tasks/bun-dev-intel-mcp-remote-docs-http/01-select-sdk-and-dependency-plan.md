# Task 01 - Select MCP SDK/Package Plan And Dependency Baseline

## Goal

Make the minimum dependency and package changes needed for Hono, Streamable HTTP, Postgres access, migrations, and future embeddings without adding product behavior yet.

## Motivation

The project currently uses a narrow stdio-focused MCP package. The remote HTTP server may require different MCP SDK packages or middleware. Dependencies must be introduced deliberately so later tasks are not blocked by package drift or incompatible transport abstractions.

## Scope

- Decide whether to keep `@modelcontextprotocol/server`, move to `@modelcontextprotocol/sdk`, or add official MCP middleware packages.
- Add Hono dependency if not already present.
- Add Postgres client/migration dependencies chosen for Bun compatibility.
- Add any minimal test utilities needed for HTTP handler tests.
- Add package scripts only when they are needed by later tasks and do not start long-running services.
- Update docs with the chosen package plan.

## Out Of Scope

- No Hono app implementation.
- No HTTP server startup.
- No migrations.
- No docs retrieval logic.
- No Docker files.

## Architecture Requirements

- Keep transport packages isolated from docs retrieval modules.
- Do not remove stdio dependencies or behavior.
- Avoid introducing a heavy framework beyond Hono unless required by the official MCP SDK.
- Prefer dependencies that work in Bun without Node-specific shims.

## Tests To Implement First

Add or update a focused package/dependency test, for example:

- `tests/unit/scaffold.test.ts`
  - Expected dependency entries exist.
  - Existing scripts still exist.
  - No `start` script points to a not-yet-implemented HTTP entrypoint.

Add an import smoke test only for selected packages:

- MCP server package import compiles.
- Hono import compiles.
- Postgres client import compiles.

## Validation

- `bun test tests/unit/scaffold.test.ts`
- `bun run typecheck`
- `bun run check`

## Acceptance Criteria

- Dependency plan is explicit and documented.
- Existing stdio tests still pass.
- Package changes do not introduce product behavior.
- Future HTTP and DB tasks can import selected packages.

## Commit Guidance

Commit dependency files, lockfile changes, and package-plan docs only.

Suggested message:

```text
chore: add remote docs HTTP dependency baseline
```
