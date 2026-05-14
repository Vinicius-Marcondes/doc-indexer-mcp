# Task 01: Add workspace and admin console scaffold

## Goal

Add the BHVR-inspired workspace structure for the optional admin console without moving the existing MCP server source tree.

## Why

The admin console needs separate frontend, backend, and shared contracts, but a full migration of existing `src/` into a new server package would create unnecessary risk.

## Scope

- Add root package workspaces for:
  - `apps/admin-console/client`
  - `apps/admin-console/server`
  - `packages/admin-contracts`
- Preserve existing root commands.
- Add admin-specific scripts without breaking `bun test`, `bun run typecheck`, or `bun run check`.
- Add minimal TypeScript configs for each new workspace.
- Add a skeleton Hono admin server with health and readiness placeholders.
- Add a skeleton Vite React app with no admin functionality yet.
- Add shared contract package exports.

## Out Of Scope

- No authentication.
- No database schema changes.
- No admin API business routes.
- No Docker changes.

## Required Tests

- Failing scaffold tests first:
  - root package declares expected workspaces.
  - admin server exports a Hono app factory.
  - shared contracts package exports at least one smoke schema.
- Run:
  - `bun test`
  - `bun run typecheck`

## Acceptance Criteria

- Existing MCP server and worker entrypoints remain unchanged.
- Root quality gates still pass.
- The admin console scaffold can be built or typechecked through root scripts.
- No existing source files are moved.
