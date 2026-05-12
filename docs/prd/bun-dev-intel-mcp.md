# PRD: Bun Dev Intelligence MCP Server

## 1. Summary

Build a future Model Context Protocol (MCP) server that gives coding agents current, source-backed guidance for developing Bun projects. The server will inspect a local Bun project, consult official Bun documentation and npm registry metadata, and return compact recommendations that help an agent choose correct Bun commands, TypeScript settings, dependency versions, test patterns, and project structure.

This PRD is documentation only. It does not create the MCP package, install dependencies, scaffold source files, or implement tests. Implementation must happen later, after this PRD is reviewed.

## 2. Motivation

Coding agents often rely on model memory, local repository context, and package-manager behavior. That is not enough when working with fast-moving tools such as Bun, TypeScript, and the MCP TypeScript SDK. The agent needs a repeatable way to check current official sources before planning or changing a Bun project.

The goal is not to replace agent reasoning. The goal is to provide the agent with a trustworthy, structured "Bun project intelligence" layer:

- What does this repository currently use?
- Which Bun-specific conventions are present or missing?
- What do current official Bun docs recommend?
- Which dependency versions and peer dependency constraints are current in npm metadata?
- What commands should the agent recommend or run outside the MCP server?
- What risks should the agent consider before editing code?

## 3. Target Users

- Coding agents that need to plan or implement work inside Bun projects.
- Developers who want source-backed project review before dependency or framework changes.
- Future repo maintainers who need a consistent policy for how agents choose Bun commands, dependency versions, TypeScript settings, and tests.

## 4. Goals

- Provide Bun-specific project analysis through MCP tools.
- Use current official sources instead of model memory for Bun guidance.
- Return cited, timestamped, compact recommendations suitable for agent planning.
- Detect Bun project structure, package manager choices, lockfiles, TypeScript config, scripts, workspace layout, imports, and Bun API usage.
- Help agents choose Bun-native commands such as `bun add`, `bun add -d`, `bun install`, `bun test`, and `bunx` when appropriate.
- Help agents avoid stale or unsafe assumptions such as using npm/yarn commands in Bun-first projects, ignoring `bun.lock`, or missing Bun TypeScript definitions.
- Make future implementation test-driven.

## 5. Non-Goals For V1

- Do not implement the MCP server as part of this PRD step.
- Do not support all JavaScript runtimes. V1 focuses on Bun.
- Do not perform broad open-web search.
- Do not use Stack Overflow, blogs, social media, or general search results as recommendation sources.
- Do not execute shell commands from inside the MCP server.
- Do not modify the analyzed project.
- Do not install dependencies.
- Do not run tests, linters, formatters, builds, or package-manager commands.
- Do not read `node_modules`.
- Do not act as a full security scanner.
- Do not support remote HTTP transport in V1.

## 6. Product Scope

### Implementation Target

- Language: TypeScript.
- Runtime and package manager: Bun.
- MCP SDK track: MCP TypeScript SDK v2 alpha, using `@modelcontextprotocol/server`.
- MCP transport: stdio only.
- Schema validation: Zod v4-compatible schemas.
- Test runner: `bun:test`.
- Cache storage: SQLite.

The SDK selection is intentional but risky: the MCP TypeScript SDK repository currently identifies its main branch as v2 in development/pre-alpha and still states that v1.x remains the production recommendation until stable v2 ships. The future implementer must pin exact SDK versions and record compatibility notes during implementation.

Implementation compatibility note from 2026-05-12: official GitHub documentation for `@modelcontextprotocol/server@2.0.0-alpha.2` documents `@modelcontextprotocol/server/stdio`, but the npm metadata for the published `2.0.0-alpha.2` artifact does not expose `./stdio`. V1 may therefore use a local stdio transport compatible with the SDK transport shape until the published v2 alpha package exposes the documented subpath. This does not change the V1 transport scope: stdio remains the only transport.

### Official Source Policy

V1 may use only these external source classes:

- Bun official docs:
  - `https://bun.com/docs/llms.txt`
  - `https://bun.com/docs/llms-full.txt`
  - Individual pages under `https://bun.com/docs/`
- npm registry metadata:
  - `https://registry.npmjs.org/{packageName}`
- MCP official docs and TypeScript SDK repository:
  - `https://modelcontextprotocol.io/`
  - `https://github.com/modelcontextprotocol/typescript-sdk`
- TypeScript official docs:
  - `https://www.typescriptlang.org/docs/`
  - `https://www.typescriptlang.org/tsconfig/`

The server must reject or ignore non-allowlisted source domains in V1.

## 7. MCP Tools

All tools must return structured JSON in MCP text content or structured content, depending on final SDK support. Responses must be concise enough for coding agents to use directly in planning.

Every tool response must include:

- `generatedAt`: ISO timestamp.
- `cacheStatus`: `"fresh"`, `"stale"`, `"miss"`, or `"disabled"`.
- `sources`: source citations used for the response.
- `confidence`: `"high"`, `"medium"`, or `"low"`.
- `recommendations`: actionable guidance items.
- `warnings`: risks, incompatibilities, or missing data.

### 7.1 `analyze_bun_project`

Purpose: Inspect a local project and return Bun-specific project facts and risks.

Input:

```json
{
  "projectPath": "string",
  "forceRefresh": "boolean?"
}
```

Output fields:

- `projectPath`
- `packageManager`
- `lockfiles`
- `packageJson`
- `workspaces`
- `scripts`
- `dependencies`
- `devDependencies`
- `tsconfig`
- `bunfig`
- `sourceAnalysis`
- `testAnalysis`
- `risks`
- `recommendations`
- `sources`

Required analysis:

- Detect `package.json`.
- Detect `bun.lock`.
- Detect legacy `bun.lockb`.
- Detect foreign lockfiles: `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`.
- Detect `bunfig.toml`.
- Detect `tsconfig.json` and relevant compiler options.
- Detect workspaces from `package.json`.
- Detect scripts for `test`, `typecheck`, `lint`, `dev`, `build`, and `start`.
- Detect `@types/bun`, `typescript`, and `bun-types`-related configuration.
- Use the TypeScript compiler API to analyze JS/TS source files.
- Detect imports from `bun`, `bun:test`, `bun:sqlite`, `node:*`, package imports, and relative imports.
- Detect `Bun.*` global usage, including `Bun.serve`, `Bun.file`, `Bun.write`, `Bun.spawn`, `Bun.password`, and `Bun.env`.
- Detect test files and usage of `bun:test`.

Exclusions:

- Never read `node_modules`.
- Exclude `.git`, `dist`, `build`, `.cache`, `coverage`, `.turbo`, `.next`, `.expo`, generated output, and binary files.

### 7.2 `search_bun_docs`

Purpose: Search official Bun documentation and return relevant excerpts with source citations.

Input:

```json
{
  "query": "string",
  "topic": "runtime | package-manager | test-runner | bundler | typescript | workspaces | deployment | security | unknown?",
  "forceRefresh": "boolean?"
}
```

Output fields:

- `query`
- `topic`
- `results`
- `sources`
- `cacheStatus`
- `recommendations`

Result fields:

- `title`
- `url`
- `snippet`
- `relevanceScore`
- `fetchedAt`

Behavior:

- Discover pages through Bun's docs index before fetching detail pages.
- Prefer `llms-full.txt` for broad local search when available.
- Return no more than the top relevant results by default.
- Do not fabricate snippets when docs are unavailable.

### 7.3 `get_bun_best_practices`

Purpose: Return Bun-specific recommendations for a topic, optionally tailored to a local project.

Input:

```json
{
  "topic": "typescript | dependencies | lockfile | tests | workspaces | runtime | bundler | deployment | security",
  "projectPath": "string?",
  "forceRefresh": "boolean?"
}
```

Output fields:

- `topic`
- `projectFit`
- `recommendations`
- `warnings`
- `sources`

Required topic coverage:

- TypeScript settings:
  - Check for `@types/bun`.
  - Check for `types: ["bun"]`.
  - Check Bun-relevant compiler options such as `moduleResolution: "bundler"`, `module: "Preserve"`, `target: "ESNext"`, and `noEmit: true` when appropriate.
- Dependencies:
  - Prefer Bun-native install commands in Bun-first projects.
  - Use npm registry metadata for version, deprecation, peer dependency, and engine signals.
- Lockfiles:
  - Prefer `bun.lock` for current Bun projects.
  - Warn on legacy `bun.lockb` and mixed lockfiles.
- Tests:
  - Prefer `bun:test` patterns for Bun-native projects.
  - Recommend `bun test` as the default test command when the project is Bun-first.
- Workspaces:
  - Detect and explain workspace-aware install recommendations.
- Runtime:
  - Detect usage of Bun runtime APIs and cite relevant docs.

### 7.4 `plan_bun_dependency`

Purpose: Help an agent choose dependency install commands and flag metadata risks.

Input:

```json
{
  "projectPath": "string",
  "packages": [
    {
      "name": "string",
      "requestedRange": "string?"
    }
  ],
  "dependencyType": "dependencies | devDependencies | optionalDependencies?"
}
```

Output fields:

- `installCommand`
- `packages`
- `metadata`
- `peerDependencyWarnings`
- `engineWarnings`
- `deprecationWarnings`
- `workspaceNotes`
- `recommendations`
- `sources`

Behavior:

- Use npm registry metadata for package versions and dist-tags.
- Prefer `bun add` for runtime dependencies.
- Prefer `bun add -d` for development dependencies.
- Include version ranges only when justified by project constraints or user request.
- Warn if npm metadata says a package or version is deprecated.
- Warn on peer dependencies that conflict with project dependencies.
- Warn when `engines` metadata appears incompatible with project/runtime constraints.
- Do not install packages.
- Do not mutate lockfiles.

### 7.5 `review_bun_project`

Purpose: Produce an agent-ready context packet before planning work in a Bun project.

Input:

```json
{
  "projectPath": "string",
  "focus": "typescript | dependencies | tests | lockfile | runtime | all?"
}
```

Output fields:

- `summary`
- `projectProfile`
- `keyRisks`
- `recommendedNextActions`
- `validationCommandsForAgent`
- `sources`
- `confidence`

Behavior:

- Combine project analysis, best-practice guidance, docs citations, and dependency metadata when needed.
- Return commands only as recommendations for the agent to run externally.
- Include a clear "do not assume latest means compatible" warning for dependency choices.

## 8. MCP Resources

### 8.1 `bun-docs://index`

Read-only resource exposing the cached Bun documentation index.

Fields:

- `fetchedAt`
- `sourceUrl`
- `pages`
- `cacheStatus`

### 8.2 `bun-docs://page/{slug}`

Read-only resource exposing a cached official Bun docs page or section.

Fields:

- `slug`
- `title`
- `url`
- `content`
- `fetchedAt`
- `contentHash`
- `cacheStatus`

### 8.3 `bun-project://analysis/{projectHash}`

Read-only resource exposing the latest cached analysis for a project path hash.

Fields:

- `projectHash`
- `projectPath`
- `generatedAt`
- `analysis`
- `sourceFileCount`
- `cacheStatus`

The resource must not expose secret values from `.env` files or similar local files.

## 9. Data Contracts

### Source Citation

```json
{
  "title": "string",
  "url": "string",
  "sourceType": "bun-docs | npm-registry | mcp-docs | typescript-docs | local-project",
  "fetchedAt": "string",
  "contentHash": "string?"
}
```

### Recommendation

```json
{
  "id": "string",
  "severity": "info | warning | error",
  "title": "string",
  "detail": "string",
  "evidence": ["string"],
  "sources": ["string"],
  "recommendedAction": "string?"
}
```

### Cache Metadata

```json
{
  "cacheStatus": "fresh | stale | miss | disabled",
  "fetchedAt": "string?",
  "expiresAt": "string?",
  "sourceUrl": "string?",
  "contentHash": "string?"
}
```

### Confidence

Confidence must reflect evidence quality:

- `high`: official source and project evidence agree.
- `medium`: official source exists, but project evidence is incomplete or ambiguous.
- `low`: source fetch failed, only stale cache is available, or project structure is ambiguous.

## 10. Local Analysis Requirements

The analyzer must be read-only.

It may read:

- `package.json`
- `bun.lock`
- `bun.lockb` presence only, unless binary parsing is explicitly designed later
- `tsconfig.json`
- `bunfig.toml`
- `.npmrc`
- source files under common directories such as `src`, `app`, `tests`, `test`, `scripts`, `packages`, and workspace package directories
- test files matching common patterns such as `*.test.ts`, `*.spec.ts`, `*.test.tsx`, and `*.spec.tsx`

It must not read:

- `node_modules`
- `.git`
- build outputs
- cache outputs
- coverage outputs
- secret files such as `.env`, `.env.local`, `.env.production`, private keys, or credential files

AST analysis must use the TypeScript compiler API or an equivalent TypeScript-aware parser. Regex-only source analysis is not acceptable for import and Bun API detection.

## 11. Cache Requirements

Use SQLite for V1 cache storage.

The cache must store:

- URL or local project hash.
- Source type.
- Raw content or normalized content.
- Content hash.
- Fetch timestamp.
- Expiry timestamp.
- HTTP status or fetch error summary when relevant.

Default TTLs:

- Bun docs: 24 hours.
- MCP docs and SDK metadata: 24 hours.
- TypeScript docs: 24 hours.
- npm package metadata: 1 hour.
- Local project analysis: invalidate by file hash and timestamp; do not rely only on TTL.

Network failure behavior:

- If fresh cache exists, return fresh cache and warn that live fetch failed.
- If stale cache exists, return stale cache with `confidence: "low"` or `"medium"` depending on task risk.
- If no cache exists, return a structured error with no fabricated guidance.

## 12. Security Requirements

- The MCP server must not execute shell commands.
- The MCP server must not mutate the analyzed project.
- The MCP server must not install packages.
- The MCP server must not rewrite files.
- The MCP server must not read `node_modules`.
- The MCP server must not read secret files.
- The MCP server must restrict network fetches to the official source allowlist.
- The MCP server must sanitize project paths and prevent traversal outside the requested project root for analysis.
- The MCP server must return recommended commands as text only, leaving execution to the agent and its normal approval/sandbox flow.

## 13. TDD Implementation Workflow

The future implementation must be test-driven. The implementer must write failing tests before implementation code.

Required sequence:

1. Scaffold the Bun TypeScript project.
2. Add test fixtures before implementation logic.
3. Write failing tests for tool schemas, source adapters, cache behavior, project analysis, AST detection, recommendation generation, and MCP registration.
4. Run `bun test` and confirm failures are expected because implementation is missing.
5. Implement the minimum code needed for the tests to pass.
6. Add or update tests for any behavior discovered during implementation.
7. Run `bun test`.
8. Run `tsc --noEmit`.
9. Optionally run live-source tests only when an explicit environment variable such as `LIVE_DOCS=1` is set.

Default tests must be deterministic and must mock network calls.

## 14. Required Test Categories

### Tool Schema Validation

- Valid inputs pass for every MCP tool.
- Missing required fields fail with useful validation errors.
- Invalid enum values fail.
- Unsafe project paths fail.

### Bun Docs Source Adapter

- Fetches and parses `llms.txt`.
- Fetches and parses `llms-full.txt` or a selected docs page.
- Searches docs content and returns ranked snippets.
- Rejects non-allowlisted URLs.
- Returns structured failure when docs cannot be fetched and no cache exists.

### npm Registry Metadata Adapter

- Fetches package metadata from `registry.npmjs.org`.
- Reads dist-tags, latest version, deprecations, peer dependencies, engines, and publish times.
- Handles missing packages.
- Handles package names with scopes.
- Uses cache when live fetch fails.

### SQLite Cache Behavior

- Stores source content with fetched timestamp and content hash.
- Returns fresh cache before TTL expiry.
- Marks cache stale after TTL expiry.
- Falls back to stale cache on network failure.
- Invalidates local project analysis when relevant file hashes change.

### Project File Inspection

- Detects `package.json`, `bun.lock`, `bun.lockb`, foreign lockfiles, `tsconfig.json`, `bunfig.toml`, scripts, dependencies, dev dependencies, and workspaces.
- Never reads `node_modules`.
- Ignores generated/build/cache directories.
- Does not read secret files.

### TypeScript AST Bun API Detection

- Detects `Bun.serve`.
- Detects `Bun.file`.
- Detects `Bun.write`.
- Detects `Bun.spawn`.
- Detects imports from `bun:test`.
- Detects imports from `bun:sqlite`.
- Detects `node:*` imports.
- Distinguishes package imports from relative imports.

### Best-Practice Recommendation Generation

- Recommends `@types/bun` when Bun APIs are used and Bun types are missing.
- Recommends Bun TypeScript compiler options when relevant.
- Warns on legacy `bun.lockb`.
- Warns on mixed lockfiles.
- Recommends `bun test` when `bun:test` is present.
- Recommends `bun add` or `bun add -d` for dependency plans.
- Includes source citations for every recommendation.

### MCP Stdio Server Registration

- Server starts with stdio transport.
- All required tools are listed.
- All required resources are listed.
- Tool descriptions are concise and clear.
- Tool schemas match this PRD.

### Network Failure And Stale-Cache Fallback

- Fresh cache is used when live fetch fails.
- Stale cache is returned with explicit warning and reduced confidence.
- No-cache failures return structured errors.
- No recommendation is fabricated without evidence.

## 15. Acceptance Criteria For Future Implementation

The future implementation is complete only when:

- The MCP server starts over stdio.
- All five required tools are registered.
- All three required resources are registered.
- Project analysis never reads `node_modules`.
- The server never executes shell commands.
- Official source allowlisting is enforced.
- Every recommendation includes citations or local project evidence.
- Docs and npm metadata responses include cache metadata.
- `bun test` passes.
- `tsc --noEmit` passes.
- Network-dependent tests are opt-in and deterministic tests pass offline.
- A usage section documents how to configure the server in a local MCP client using Bun.

## 16. Suggested Future Project Shape

This is only guidance for the later implementation phase:

```text
.
├── package.json
├── tsconfig.json
├── bun.lock
├── src
│   ├── server.ts
│   ├── tools
│   ├── resources
│   ├── analyzers
│   ├── sources
│   ├── cache
│   └── shared
└── tests
    ├── fixtures
    ├── unit
    └── integration
```

## 17. Source Baseline

The future implementation must verify current docs again before coding. These links were used to shape this PRD:

- Bun TypeScript documentation: `https://bun.com/docs/runtime/typescript`
- Bun lockfile documentation: `https://bun.com/docs/pm/lockfile`
- Bun install documentation: `https://bun.com/docs/pm/cli/install`
- Bun test documentation: `https://bun.com/docs/test/writing-tests`
- Bun documentation index: `https://bun.com/docs/llms.txt`
- MCP server concepts: `https://modelcontextprotocol.io/docs/learn/server-concepts`
- MCP tools specification: `https://modelcontextprotocol.io/specification/2025-06-18/server/tools`
- MCP resources specification: `https://modelcontextprotocol.io/specification/2025-06-18/server/resources`
- MCP TypeScript SDK repository: `https://github.com/modelcontextprotocol/typescript-sdk`
- TypeScript documentation: `https://www.typescriptlang.org/docs/`
- TypeScript TSConfig reference: `https://www.typescriptlang.org/tsconfig/`

## 18. Open Questions For Later Review

- Should V1 include TypeScript docs search as a first-class tool or keep TypeScript docs only as a supporting source for Bun TypeScript recommendations?
- Should project analysis support non-TypeScript Bun projects with reduced AST capability?
- Should the cache file live inside the MCP package, the user cache directory, or a configurable path?
- Should future versions add HTTP transport after stdio is stable?
- Should future versions support framework-specific Bun usage such as Hono, Elysia, Vite, or Next.js on Bun?

## 19. Task Files And Tracker

The implementation task plan is split into small cluster files so agents can avoid loading unnecessary context. Start with the tracker and task index, then open only the cluster for the active task.

- Task index: [docs/tasks/bun-dev-intel-mcp-tasks.md](../tasks/bun-dev-intel-mcp-tasks.md)
- Tracker: [docs/tasks/bun-dev-intel-mcp/tracker.md](../tasks/bun-dev-intel-mcp/tracker.md)
- Baseline, scaffold, and fixtures: [00-baseline-scaffold-fixtures.md](../tasks/bun-dev-intel-mcp/00-baseline-scaffold-fixtures.md)
- Contracts, security, and cache: [01-contracts-security-cache.md](../tasks/bun-dev-intel-mcp/01-contracts-security-cache.md)
- Official source adapters: [02-official-source-adapters.md](../tasks/bun-dev-intel-mcp/02-official-source-adapters.md)
- Project analysis and AST: [03-project-analysis-ast.md](../tasks/bun-dev-intel-mcp/03-project-analysis-ast.md)
- Recommendations and MCP tools: [04-recommendations-tools.md](../tasks/bun-dev-intel-mcp/04-recommendations-tools.md)
- Resources, server, QA, and handoff: [05-resources-server-qa-handoff.md](../tasks/bun-dev-intel-mcp/05-resources-server-qa-handoff.md)

Tracker usage requirements:

- Before starting implementation, update `Current Task` in the tracker with the task ID, title, status, owner, and planned validation.
- Keep only one task marked `in_progress`.
- After finishing a task, update the task status table and append a short `Work Log` entry.
- Work log entries should stay brief: date, task, status, what changed, and tests run.
- If scope changes, pause implementation and update this PRD before continuing.
