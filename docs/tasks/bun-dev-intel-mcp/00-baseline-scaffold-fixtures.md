# 00 - Baseline, Scaffold, And Fixtures

Read this file only when working on source revalidation, project scaffold, or fixture setup.

## Task 0.1: Revalidate External Assumptions

Purpose: Ensure implementation starts from current official sources instead of the PRD's snapshot.

Implementation guidance:

- Re-open the MCP TypeScript SDK repository and confirm current v2 alpha package names, imports, server construction API, and stdio transport API.
- Re-open Bun docs for TypeScript, install behavior, lockfiles, test runner, workspaces, and docs index files.
- Re-open TypeScript TSConfig docs for compiler option references used in recommendations.
- Record checked URLs and checked date in implementation notes or README.
- Do not write implementation code in this task.

Tests to implement:

- No product tests are required.
- Add a lightweight docs check only if the project later has a docs lint system.

Acceptance criteria:

- Current official docs have been verified before coding.
- Any PRD mismatch is captured as a PRD update request before implementation proceeds.
- SDK package names and imports are known before scaffold work starts.

QA impact:

- Prevents building against stale SDK or Bun assumptions.
- Reduces rework caused by pre-alpha MCP SDK API drift.

## Task 1.1: Scaffold Bun TypeScript Package

Purpose: Create the minimal project foundation without implementing product behavior.

Implementation guidance:

- Create a Bun package at the repository root unless the PRD changes.
- Add `package.json`, `tsconfig.json`, and source/test directories.
- Add scripts for `test`, `typecheck`, and `dev`.
- Configure TypeScript for Bun-compatible development.
- Add dependencies needed for MCP server, schema validation, TypeScript, tests, and SQLite access.
- Keep source entrypoints minimal until behavior tests exist.

Tests to implement first:

- `tests/unit/scaffold.test.ts`
  - Assert expected package scripts exist.
  - Assert `tsconfig.json` exists and can be parsed.
  - Assert source and test directories exist.

Acceptance criteria:

- `bun install` creates `bun.lock`.
- `bun test` can run at least the scaffold tests.
- `bun run typecheck` or equivalent runs TypeScript with `noEmit`.
- The project has no MCP behavior beyond compile-safe placeholders.

QA impact:

- Establishes repeatable test and typecheck baselines.
- Prevents setup problems from hiding inside product failures.

## Task 1.2: Create Fixture Projects

Purpose: Provide deterministic local projects for analyzer and tool tests.

Implementation guidance:

- Create fixtures under `tests/fixtures/projects`.
- Fixtures must be small and must not contain installed dependencies.
- Use plain fixture files instead of generated fixtures when possible.
- Include a fixture manifest explaining each fixture's purpose.

Required fixtures:

- Minimal Bun TypeScript project with `package.json`, `bun.lock`, `tsconfig.json`, and `src/index.ts`.
- Bun project missing `@types/bun`.
- Project with legacy `bun.lockb` presence.
- Project with mixed lockfiles.
- Bun workspace with root and package-level manifests.
- Project using `bun:test`.
- Project using `Bun.serve`, `Bun.file`, `Bun.write`, `Bun.spawn`, `bun:sqlite`, and `node:*`.
- Project containing ignored directories: `node_modules`, `dist`, `build`, `.cache`, `coverage`.
- Project containing secret-like files such as `.env` that must not be read.

Tests to implement first:

- `tests/fixtures/fixtures.test.ts`
  - Assert all required fixture directories exist.
  - Assert fixture projects do not contain real dependency installs.
  - Assert ignored directories exist in the ignore fixture so skip behavior can be tested.

Acceptance criteria:

- Every later analyzer test can use a fixture instead of constructing projects inline.
- Fixtures are readable and intentionally small.
- No fixture requires network access.

QA impact:

- Makes analyzer behavior reproducible.
- Prevents tests from depending on local machine state or package cache.
