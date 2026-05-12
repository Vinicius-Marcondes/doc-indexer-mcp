# AGENTS.md

This file provides guidance to AI Agents when working with code in this repository.
  
## Project

`bun-dev-intel-mcp` — a source-backed MCP (Model Context Protocol) stdio server that analyzes local Bun/TypeScript projects, searches official Bun docs, plans Bun dependency commands, and exposes read-only MCP resources. Runtime is Bun; tests use `bun:test`; schemas use Zod v4.

The implementation is driven by `docs/prd/bun-dev-intel-mcp.md` (PRD) and the task cluster files under `docs/tasks/bun-dev-intel-mcp/` (start at `tracker.md`, then open only the active cluster file). When scope changes, the PRD is the source of truth — update it before implementation.

## Commands

```bash
bun test                          # full test suite (offline, deterministic)
bun test path/to/file.test.ts     # single file
bun test -t "name pattern"        # filter by test name
LIVE_DOCS=1 bun test tests/live   # opt-in live checks (Bun docs + npm registry only)
bun run typecheck                 # tsc --noEmit
bun run check                     # bun test && typecheck (pre-merge gate)
bun --watch src/server.ts         # dev (alias: bun run dev)
```

Tests under `tests/fixtures/projects/**` are excluded from the TS compile (`tsconfig.json` `exclude`).

## Architecture

The server (`src/server.ts`) wires a single `McpServer` instance via dependency injection: a `ServerDependencies` bundle (cache, fetch client, source adapters, analysis store, `now()`) is constructed once and passed to tool/resource handlers. `defaultCachePath()` writes SQLite to `~/.cache/bun-dev-intel-mcp/cache.sqlite`. The stdio entrypoint (`src/stdio.ts`) ships a **local `LocalStdioServerTransport`** because the published `@modelcontextprotocol/server@2.0.0-alpha.2` package does not expose the documented `./stdio` subpath — keep this shim until the upstream alpha exposes the subpath. Transport scope is stdio only.

Layered modules (all read-only with respect to analyzed projects):

- `src/tools/` — five MCP tools: `analyze_bun_project`, `search_bun_docs`, `get_bun_best_practices`, `plan_bun_dependency`, `review_bun_project`. Each tool composes analyzers + sources + recommendations and returns a response shaped by `src/shared/contracts.ts`.
- `src/resources/` — three MCP resources: `bun-docs://index`, `bun-docs://page/{slug}`, `bun-project://analysis/{projectHash}`. `project-analysis-store.ts` keys analyses by hash for resource lookup.
- `src/analyzers/` — read-only project inspection: `package-json`, `lockfiles`, `tsconfig`, `bunfig`, `source-discovery`, `ast-imports`, `ast-bun-globals`, `test-analysis`. AST work uses the TypeScript compiler API — **regex-only source analysis is not acceptable** for imports or `Bun.*` detection.
- `src/sources/` — external adapters behind `SourceFetchClient`: `bun-docs-index`, `bun-docs-search`, `bun-docs-page`, `npm-registry`. `allowlist.ts` enforces the official source policy; non-allowlisted URLs must be rejected.
- `src/cache/` — `sqlite-cache.ts` is the cache store; `fallback-policy.ts` decides fresh/stale/miss behavior. Network failures fall back to stale cache and surface `cacheStatus` in responses.
- `src/recommendations/` — `rules.ts` (best-practice rule set), `confidence.ts` (high/medium/low scoring), `dependency-plan.ts` (Bun add/install/remove planning). Every recommendation must cite sources via `SourceCitation` from `shared/contracts.ts`.
- `src/security/` — `project-paths.ts` (path-boundary checks) and `ignore-policy.ts` (skip lists). The analyzer must never read `node_modules`, `.git`, build/cache/coverage outputs, or secret files (`.env*`, credentials).
- `src/shared/` — `contracts.ts` (Zod schemas: `cacheStatus`, `confidence`, `sourceType`, `recommendation`, `cacheMetadata`, base response shape), `errors.ts` (structured errors), `project-hash.ts`.

## Conventions

- **Source-backed**: every recommendation/response includes `sources: SourceCitation[]` and a `cacheStatus`. Don't return advice without a citation path.
- **Official source allowlist** (PRD §6): Bun docs (`bun.com/docs/llms.txt`, `llms-full.txt`, pages), `registry.npmjs.org`, `modelcontextprotocol.io`, `github.com/modelcontextprotocol/typescript-sdk`, `typescriptlang.org`. Adding a new external source requires updating `src/sources/allowlist.ts` and the PRD.
- **TDD workflow** (PRD §13): tests first; live network is opt-in via `LIVE_DOCS=1`. Default test runs must be deterministic and offline — adapters take a `FetchLike` so they can be stubbed.
- **TypeScript**: `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `verbatimModuleSyntax`, `allowImportingTsExtensions`. Import `.ts` extensions explicitly. Zod imports use `zod/v4`.
- **Tracker discipline**: keep one task `in_progress` in `docs/tasks/bun-dev-intel-mcp/tracker.md`; append a brief Work Log entry on completion.

## Repository rules (`AGENTS.md`)

- Never read inside `node_modules`.
- Never run `git push origin master`.
- Before any `git` command, read the git rules under `docs/` (note: as of this writing, no `docs/git*` file exists yet — confirm or surface the gap before pushing).
