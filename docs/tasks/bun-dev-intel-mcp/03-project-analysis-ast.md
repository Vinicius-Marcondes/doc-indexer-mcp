# 03 - Project Analysis And AST

Read this file only when working on local project inspection, manifests, config parsing, file discovery, or TypeScript AST analysis.

## Task 8.1: Parse `package.json`

Purpose: Extract project identity, scripts, dependencies, dev dependencies, optional dependencies, workspaces, and Bun-related metadata.

Implementation guidance:

- Parse JSON with helpful errors for invalid syntax.
- Capture scripts: `test`, `typecheck`, `lint`, `dev`, `build`, and `start`.
- Capture dependency maps.
- Capture `workspaces`.
- Capture `trustedDependencies` if present.
- Detect `@types/bun`, `typescript`, and MCP/Bun-related packages.

Tests to implement first:

- `tests/unit/analyzers/package-json.test.ts`
  - Parses scripts.
  - Parses dependencies and dev dependencies.
  - Detects `@types/bun`.
  - Detects workspaces.
  - Handles missing `package.json`.
  - Handles invalid `package.json`.

Acceptance criteria:

- Analyzer output matches PRD fields.
- Invalid manifests produce structured parse errors.
- Missing optional fields are represented consistently.

QA impact:

- Gives higher-level tools accurate project context.
- Prevents recommendations from guessing scripts or dependency state.

## Task 8.2: Detect Lockfiles And Package Manager Signals

Purpose: Identify whether the project is Bun-first and warn on mixed or legacy lockfiles.

Implementation guidance:

- Detect `bun.lock`.
- Detect `bun.lockb` presence.
- Detect `package-lock.json`, `pnpm-lock.yaml`, and `yarn.lock`.
- Classify package manager confidence as high/medium/low.
- Warn when Bun and non-Bun lockfiles coexist.
- Warn when only legacy `bun.lockb` exists.

Tests to implement first:

- `tests/unit/analyzers/lockfiles.test.ts`
  - Detects `bun.lock`.
  - Detects legacy `bun.lockb`.
  - Detects npm/pnpm/yarn lockfiles.
  - Classifies Bun-first project.
  - Warns on mixed lockfiles.
  - Does not read lockfile contents unnecessarily.

Acceptance criteria:

- Lockfile findings are included in `analyze_bun_project`.
- Mixed-lockfile warnings include local file evidence.
- Current Bun text lockfile preference is cited in recommendations where applicable.

QA impact:

- Reduces package-manager inconsistency.
- Helps agents avoid accidentally changing the wrong lockfile.

## Task 8.3: Parse `tsconfig.json`

Purpose: Identify Bun-relevant TypeScript configuration and gaps.

Implementation guidance:

- Parse `tsconfig.json`, including comments if the chosen parser supports JSONC.
- Extract `compilerOptions.types`, `moduleResolution`, `module`, `target`, `noEmit`, `strict`, `skipLibCheck`, and related options from the PRD.
- Detect missing `types: ["bun"]` when Bun APIs are used or Bun project context exists.
- Do not require every Bun docs option in all projects; recommendations should account for project fit.

Tests to implement first:

- `tests/unit/analyzers/tsconfig.test.ts`
  - Parses Bun-recommended settings.
  - Detects missing `types: ["bun"]`.
  - Detects non-bundler module resolution.
  - Handles missing tsconfig.
  - Handles invalid tsconfig.

Acceptance criteria:

- TypeScript config output is available to recommendations.
- Missing config produces warnings, not crashes.
- Recommendations distinguish required fixes from advisory improvements.

QA impact:

- Improves type safety for Bun APIs.
- Prevents agents from applying generic Node TypeScript settings blindly.

## Task 8.4: Parse `bunfig.toml`

Purpose: Capture Bun-specific config that may affect installs, tests, or runtime behavior.

Implementation guidance:

- Detect `bunfig.toml`.
- Parse only fields needed by V1 recommendations.
- If no TOML parser is used, keep parser minimal and explicitly limited.
- Malformed config should produce a structured warning.

Tests to implement first:

- `tests/unit/analyzers/bunfig.test.ts`
  - Detects missing bunfig.
  - Parses a simple valid bunfig fixture.
  - Reports malformed bunfig.
  - Includes file evidence without leaking unrelated content.

Acceptance criteria:

- Analyzer reports whether `bunfig.toml` exists.
- Relevant settings can be surfaced to future recommendations.
- Malformed config does not stop whole-project analysis.

QA impact:

- Preserves Bun-specific context beyond `package.json`.
- Makes analysis robust in partially configured projects.

## Task 9.1: Discover Analyzable Source Files

Purpose: Find JS/TS files safely and consistently for AST analysis.

Implementation guidance:

- Search common directories: `src`, `app`, `test`, `tests`, `scripts`, `packages`, and workspace directories.
- Include `.ts`, `.tsx`, `.js`, `.jsx`, `.mts`, `.cts`.
- Exclude ignored directories and secret files.
- Limit file count and file size to prevent runaway analysis.
- Return skipped counts and reasons.

Tests to implement first:

- `tests/unit/analyzers/source-discovery.test.ts`
  - Finds source files in common directories.
  - Finds workspace package source files.
  - Skips ignored directories.
  - Skips oversized files.
  - Skips binary files.
  - Never traverses into `node_modules`.

Acceptance criteria:

- Source discovery is deterministic for fixtures.
- AST analyzer receives only allowed files.
- Large or unusual projects fail gracefully with warnings.

QA impact:

- Protects performance and privacy.
- Prevents accidental reads of dependency or generated code.

## Task 9.2: Detect Imports With TypeScript AST

Purpose: Extract imports accurately enough to classify Bun, Node, package, and relative usage.

Implementation guidance:

- Use TypeScript compiler API or equivalent TypeScript-aware parser.
- Detect static imports.
- Detect export-from declarations.
- Detect dynamic imports where straightforward.
- Classify module specifiers as `bun`, `bun:test`, `bun:sqlite`, `node:*`, package imports, relative imports, or absolute/path-alias imports.
- Capture file path and source location when safe.

Tests to implement first:

- `tests/unit/analyzers/ast-imports.test.ts`
  - Detects `bun:test`.
  - Detects `bun:sqlite`.
  - Detects `node:fs`.
  - Detects package imports.
  - Detects relative imports.
  - Detects dynamic imports.
  - Does not use regex-only parsing.

Acceptance criteria:

- Import analysis works for TS and JS fixtures.
- Parse errors in one file do not stop analysis of other files.
- Output supports dependency and test recommendations.

QA impact:

- Gives recommendations real code evidence.
- Reduces false positives compared with regex scanning.

## Task 9.3: Detect Bun Global API Usage

Purpose: Identify Bun runtime APIs used without relying on text search.

Implementation guidance:

- Walk AST expressions for `Bun.<member>` accesses.
- Required members: `serve`, `file`, `write`, `spawn`, `password`, `env`.
- Capture counts and file evidence.
- Distinguish local variables named `Bun` if feasible.
- If shadowing detection is incomplete, return a confidence warning.

Tests to implement first:

- `tests/unit/analyzers/ast-bun-globals.test.ts`
  - Detects `Bun.serve`.
  - Detects `Bun.file`.
  - Detects `Bun.write`.
  - Detects `Bun.spawn`.
  - Detects `Bun.password`.
  - Detects `Bun.env`.
  - Handles syntax errors gracefully.
  - Handles local `Bun` shadowing according to implemented confidence policy.

Acceptance criteria:

- Bun API usage appears in `sourceAnalysis`.
- Evidence includes file path and count, not full source content.
- Missing Bun types can be recommended when Bun globals are used.

QA impact:

- Connects code usage to TypeScript and runtime recommendations.
- Makes guidance specific instead of generic.

## Task 9.4: Detect Tests And `bun:test`

Purpose: Understand the project's current testing style.

Implementation guidance:

- Detect test files by file name patterns.
- Detect imports from `bun:test`.
- Detect common functions imported from `bun:test`: `test`, `expect`, `describe`, `beforeEach`, and `afterEach`.
- Detect test script in `package.json`.
- Recommend `bun test` only when project context supports Bun-first testing.

Tests to implement first:

- `tests/unit/analyzers/test-analysis.test.ts`
  - Finds `*.test.ts`.
  - Finds `*.spec.ts`.
  - Detects `bun:test` imports.
  - Detects test script using `bun test`.
  - Warns when Bun tests exist but no test script exists.

Acceptance criteria:

- `testAnalysis` is included in project analysis.
- Recommendations can distinguish missing tests from missing scripts.
- Test style is based on AST evidence, not file names alone.

QA impact:

- Improves quality gates for future Bun projects.
- Helps agents preserve existing test conventions.
