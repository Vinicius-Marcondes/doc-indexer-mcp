# PRD: Bun Dev Intelligence MCP Agent Output V2

## 1. Summary

Improve the Bun Dev Intelligence MCP Server so its default outputs are optimized for coding agents making the next tool call, not for humans auditing a full project dump.

This PRD adds an agent-first response contract, compact response budgets, task-shaped tools, structured executable recommendations, citation de-duplication, source-backed change metadata, and finding-level caching. It builds on the existing V1 server described in `docs/prd/bun-dev-intel-mcp.md`.

This PRD is documentation only. It does not implement the new contracts, tools, cache behavior, or tests. Implementation must happen later after this PRD and the task plan are reviewed.

## 2. Motivation

The V1 MCP server solves the right core problem: agents need current, source-backed Bun guidance instead of stale model memory. Real agent testing showed that the server can still miss its product goal when a response is too large or too raw.

Agents call MCP tools with an immediate task in mind:

- "I am about to install a package."
- "I am about to use a Bun API."
- "I am editing this file."
- "I need a quick project health check before changing code."

Large analysis payloads force the agent to perform filtering client-side. That increases token use, makes stale or low-priority findings easier to quote, and weakens the connection between MCP evidence and the next edit or command.

The product should push task filtering, ranking, citation compaction, and action shaping into the server.

## 3. Target Users

- Coding agents using the MCP server while editing Bun projects.
- Developers who want the MCP server to change agent behavior, not merely produce reference material.
- Future maintainers building related intelligence MCPs for Hono, Prisma, TypeScript, or other frameworks and needing a shared response model.

## 4. Goals

- Make compact, agent-ready output the default for high-frequency tools.
- Keep full raw analysis available as an explicit opt-in.
- Standardize a reusable response shape for Bun and future framework intelligence MCPs.
- Add task-shaped tools for package installation, API usage, single-file linting, and project health review.
- Return structured findings and fixes that agents can safely turn into proposed edits or approval-gated commands.
- Deduplicate citations with a top-level citation map and per-finding citation IDs.
- Surface source-backed change metadata such as `sinceVersion`, `sinceDate`, and `breaking` only when official evidence supports it.
- Cache local findings at the file/rule level so repeated calls avoid duplicate payloads and can return deltas.
- Preserve V1 safety boundaries: no server-side shell execution, package installation, or project mutation.

## 5. Non-Goals For V2

- Do not remove V1 tools without a compatibility path.
- Do not execute suggested commands from inside the MCP server.
- Do not mutate analyzed projects.
- Do not install packages.
- Do not run tests, linters, builds, or package-manager commands.
- Do not read `node_modules`.
- Do not infer Bun version changes from model memory.
- Do not claim a recommendation is "new since training cutoff" unless official source metadata supports it.
- Do not add broad web search.
- Do not support remote HTTP transport.
- Do not build full framework-specific MCPs such as Hono or Prisma in this phase.

## 6. Product Scope

### Implementation Target

- Runtime: Bun.
- Language: TypeScript.
- MCP transport: stdio only.
- Schema validation: Zod v4-compatible schemas.
- Test runner: `bun:test`.
- Cache storage: existing SQLite cache extended for local finding records.

### Compatibility Policy

V2 should prefer additive changes:

- Existing V1 tools remain registered unless explicitly deprecated in a later PRD.
- Existing tools may gain optional `responseMode` or `detail` inputs.
- New task-shaped tools use the V2 agent response envelope from the start.
- `analyze_bun_project` remains the full raw diagnostic surface and should not be the preferred tool description for normal agent planning.
- `review_bun_project` may become a compatibility alias or wrapper around `project_health`, but it must remain available during V2.

### Official Source Policy

V2 inherits the V1 allowlist and may add only source classes needed for change metadata:

- Bun official docs:
  - `https://bun.com/docs/llms.txt`
  - `https://bun.com/docs/llms-full.txt`
  - Individual pages under `https://bun.com/docs/`
- Bun official release or changelog sources, if revalidated before implementation:
  - Official Bun release/changelog pages under `https://bun.com/`
  - Official Bun repository release metadata under `https://github.com/oven-sh/bun`
- npm registry metadata:
  - `https://registry.npmjs.org/{packageName}`
- MCP official docs and TypeScript SDK repository:
  - `https://modelcontextprotocol.io/`
  - `https://github.com/modelcontextprotocol/typescript-sdk`
- TypeScript official docs:
  - `https://www.typescriptlang.org/docs/`
  - `https://www.typescriptlang.org/tsconfig/`

Adding release/changelog sources requires updating `src/sources/allowlist.ts`, tests, and this PRD if the exact official URLs differ during revalidation.

Revalidated for V2 implementation on 2026-05-12:

- Bun docs index and full docs are available at `https://bun.com/docs/llms.txt` and `https://bun.com/docs/llms-full.txt`.
- Bun runtime, package-manager, and test docs are available through individual `https://bun.com/docs/**` pages, including `https://bun.com/docs/runtime`, `https://bun.com/docs/test`, `https://bun.com/docs/pm/cli/install`, and `https://bun.com/docs/pm/cli/add`.
- Bun release-note evidence for change metadata should use official Bun blog release pages with the stable pattern `https://bun.com/blog/bun-v{version}` when available. These pages provide release version and publication date evidence.
- Bun repository release metadata may use `https://github.com/oven-sh/bun/releases/latest` and `https://github.com/oven-sh/bun/releases/tag/bun-v{version}`. Fetching these requires extending the allowlist to the `github.com/oven-sh/bun/releases` path family.
- npm package metadata at `https://registry.npmjs.org/{packageName}` exposes `dist-tags`, version publish `time`, `deprecated`, `peerDependencies`, and `engines` fields when present.
- `breaking` metadata must be omitted unless the official release evidence explicitly marks a change as breaking.

## 7. MCP Tools

All V2 task-shaped tools must return the shared agent response envelope from section 9.

### 7.1 `project_health`

Purpose: Return a compact, ranked project health packet for agent planning.

Input:

```json
{
  "projectPath": "string",
  "focus": "typescript | dependencies | tests | lockfile | runtime | all?",
  "responseMode": "brief | standard | full?",
  "sinceToken": "string?",
  "forceRefresh": "boolean?"
}
```

Default behavior:

- `responseMode` defaults to `brief`.
- Return only the highest-impact risks and next actions.
- Include a `detailResource` or `projectHash` when full raw analysis is available through existing resources.
- If `sinceToken` is provided, include a `delta` section showing new, changed, resolved, and repeated findings.

Output:

- Shared agent response envelope.
- `projectProfile` summary.
- `deltaToken` for follow-up calls.

### 7.2 `check_before_install`

Purpose: Help an agent decide before adding one or more npm packages to a Bun project.

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
  "dependencyType": "dependencies | devDependencies | optionalDependencies?",
  "responseMode": "brief | standard | full?",
  "forceRefresh": "boolean?"
}
```

Required behavior:

- Use npm registry metadata for versions, dist-tags, publish times, deprecation, peer dependencies, and engines.
- Use local project dependency and lockfile context.
- Prefer Bun-native commands only when the project is Bun-first or when the caller explicitly asks for Bun command planning.
- Flag likely incompatibilities and required peer checks.
- Include Bun-native alternatives only when supported by official Bun docs or local project evidence.
- Return structured command actions such as `bun add redis`, not executed commands.

Default output target:

- `brief`: less than or equal to 500 characters in `summary`, at most two findings, at most two actions.
- `standard`: include metadata warnings and one install command.
- `full`: include relevant npm metadata excerpts and all warning findings.

Relationship to V1:

- `plan_bun_dependency` may call the same planner internally.
- V2 should prefer `check_before_install` in tool descriptions for pre-install agent workflows.

### 7.3 `check_bun_api_usage`

Purpose: Answer whether a Bun API or pattern is current, canonical, risky, or changed.

Input:

```json
{
  "apiName": "string",
  "projectPath": "string?",
  "usageSnippet": "string?",
  "agentTrainingCutoff": "string?",
  "responseMode": "brief | standard | full?",
  "forceRefresh": "boolean?"
}
```

Required behavior:

- Search official Bun docs and, when available, official release/changelog evidence.
- Return a canonical usage recommendation and at most one code example by default.
- If `usageSnippet` is provided, classify it as `current`, `outdated`, `risky`, or `unknown` based on evidence.
- If `agentTrainingCutoff` is provided, mark findings that are source-backed as after that cutoff.
- Do not tag a change as after cutoff unless source dates or release metadata prove it.

Example use cases:

- `Bun.serve`
- `Bun.password.hash`
- `bun:test`
- `bun:sqlite`
- `bun install`

### 7.4 `lint_bun_file`

Purpose: Return Bun-specific findings for one file the agent is about to edit.

Input:

```json
{
  "projectPath": "string",
  "filePath": "string",
  "responseMode": "brief | standard | full?"
}
```

Required behavior:

- Enforce project path boundaries.
- Reject ignored, generated, secret-like, binary, or `node_modules` files.
- Use TypeScript AST analysis for imports and `Bun.*` usage.
- Return only file-relevant findings.
- Include precise locations when available.
- Suggest file edits as structured fix objects, but never apply them.

Default output target:

- `brief`: at most three findings and no full project profile.
- `standard`: include related project context such as missing `@types/bun` or `types: ["bun"]`.
- `full`: include all file-level AST facts used by the rules.

### 7.5 Existing Tool Updates

#### `analyze_bun_project`

Purpose remains full project analysis. V2 updates:

- Add `detail: "summary | standard | full?"`.
- Default should be `standard` only if compatibility review accepts the behavior change; otherwise keep current full output and make the tool description warn agents to prefer `project_health`.
- Include `projectHash`, `detailResource`, and V2 citations where possible.

#### `review_bun_project`

Purpose becomes compatibility wrapper for project health. V2 updates:

- Add `responseMode`.
- Use the shared agent response envelope.
- Pull official docs only as needed for the requested focus.
- Keep previous fields only if compatibility tests require them.

#### `search_bun_docs`

V2 updates:

- Add `responseMode`.
- Add `limit` if needed.
- Return citation IDs and one canonical excerpt when a query is API-shaped.

#### `get_bun_best_practices`

V2 updates:

- Use the shared finding/action schema.
- Avoid generic best-practice essays.
- Prefer direct actions and examples.

#### `plan_bun_dependency`

V2 updates:

- Add structured `actions`.
- Use citation IDs.
- Share planner internals with `check_before_install`.

## 8. MCP Resources

### 8.1 Existing Resources

Existing resources remain:

- `bun-docs://index`
- `bun-docs://page/{slug}`
- `bun-project://analysis/{projectHash}`

### 8.2 `bun-project://findings/{projectHash}`

Purpose: Expose the latest cached normalized findings for a project.

Fields:

- `projectHash`
- `projectPath`
- `generatedAt`
- `schemaVersion`
- `findings`
- `citations`
- `fileHashes`
- `cacheStatus`
- `warnings`

Behavior:

- Do not include secret file content.
- Mark stale when relevant source file hashes change.
- Return structured error when no finding cache exists.

### 8.3 Optional Future Resource: `bun-project://deltas/{deltaToken}`

This is not required for V2 unless implementation discovers that delta tokens are too large for tool responses.

## 9. Data Contracts

### Response Mode

```json
"brief | standard | full"
```

Response mode controls ranking, included detail, and summary size. It does not relax source or safety requirements.

Default mode for new task-shaped tools is `brief`.

Targets:

- `brief`: summary less than or equal to 500 characters, at most three findings, at most three actions, no full raw facts, no examples unless essential.
- `standard`: summary less than or equal to 1200 characters, at most eight findings, at most five actions, at most one example.
- `full`: complete relevant data for the requested tool, still with citation de-duplication.

### Agent Response Envelope

```json
{
  "ok": true,
  "schemaVersion": "agent-output-v1",
  "generatedAt": "ISO timestamp",
  "responseMode": "brief | standard | full",
  "summary": "string",
  "cacheStatus": "fresh | stale | miss | disabled",
  "confidence": "high | medium | low",
  "findings": [],
  "actions": [],
  "examples": [],
  "citations": {},
  "warnings": [],
  "detailResource": "string?",
  "projectHash": "string?",
  "deltaToken": "string?"
}
```

### Citation Map

```json
{
  "c1": {
    "title": "string",
    "url": "string",
    "sourceType": "bun-docs | bun-release | npm-registry | mcp-docs | typescript-docs | local-project",
    "fetchedAt": "ISO timestamp",
    "contentHash": "string?"
  }
}
```

Rules:

- Citations are top-level and de-duplicated.
- Findings, actions, examples, and warnings reference citations by ID.
- Full URL arrays should not be repeated in every finding.
- Local project evidence may be represented as citation IDs such as `local-package-json` or `local-src-server-ts` when mapped to safe local evidence.

### Finding

```json
{
  "id": "string",
  "ruleId": "string",
  "framework": "bun",
  "severity": "info | warning | error",
  "title": "string",
  "message": "string",
  "evidence": ["string"],
  "locations": [
    {
      "filePath": "string",
      "line": "number?",
      "column": "number?"
    }
  ],
  "citationIds": ["c1"],
  "fix": {},
  "change": {},
  "fingerprint": "string"
}
```

Rules:

- `fingerprint` must be stable for the same project, file hash, rule ID, and evidence.
- `locations` must not point outside `projectPath`.
- Findings must be sorted by severity, actionability, task relevance, and stable ID.

### Action

```json
{
  "id": "string",
  "kind": "command | edit | verify | manual",
  "title": "string",
  "command": "string?",
  "filePath": "string?",
  "risk": "low | medium | high",
  "requiresApproval": true,
  "reason": "string",
  "citationIds": ["c1"],
  "relatedFindingIds": ["string"]
}
```

Rules:

- Commands are text recommendations only.
- Any action that would mutate files, install packages, delete lockfiles, or run external commands must set `requiresApproval: true`.
- Edit actions describe the target and intent; they do not include huge patches in brief mode.
- Verification actions may suggest `bun test` or `bun run typecheck` but do not execute them.

### Example

```json
{
  "id": "string",
  "title": "string",
  "language": "ts | js | json | shell | text",
  "code": "string",
  "citationIds": ["c1"]
}
```

Rules:

- Brief mode should avoid examples unless the tool is `check_bun_api_usage`.
- Standard mode may include one canonical example.
- Full mode may include multiple examples when relevant.

### Change Metadata

```json
{
  "sinceVersion": "string?",
  "sinceDate": "ISO date?",
  "breaking": "boolean?",
  "afterAgentTrainingCutoff": "boolean?",
  "evidence": "official-source | npm-publish-time | unavailable",
  "citationIds": ["c1"]
}
```

Rules:

- Omit `sinceVersion`, `sinceDate`, and `breaking` when evidence is unavailable.
- Do not use model memory to populate change metadata.
- `afterAgentTrainingCutoff` may only be true when the caller provides `agentTrainingCutoff` and source dates prove the change happened later.

### Delta

```json
{
  "sinceToken": "string",
  "newFindingIds": ["string"],
  "changedFindingIds": ["string"],
  "resolvedFindingIds": ["string"],
  "repeatedFindingIds": ["string"]
}
```

Rules:

- Delta mode must never hide critical errors.
- If a `sinceToken` is invalid or expired, return a warning and a normal current response.

## 10. Local Analysis Requirements

V2 keeps all V1 read-only analysis requirements.

It may read:

- `package.json`
- `bun.lock`
- `bun.lockb` presence only unless binary parsing is explicitly designed later
- `tsconfig.json`
- `bunfig.toml`
- `.npmrc` if needed for package manager context
- Source and test files under allowed project directories

It must not read:

- `node_modules`
- `.git`
- build outputs
- cache outputs
- coverage outputs
- secret files such as `.env`, `.env.local`, `.env.production`, private keys, credentials, or token files

AST analysis must use the TypeScript compiler API or an equivalent TypeScript-aware parser. Regex-only source analysis is not acceptable for imports or `Bun.*` detection.

## 11. Cache Requirements

V2 extends the existing SQLite cache.

### Source Cache

Existing Bun docs and npm registry cache behavior remains:

- Bun docs: 24 hours by default.
- npm package metadata: 1 hour by default.
- Source failures fall back to fresh or stale cache when available.
- No-cache failures return structured errors rather than fabricated guidance.

### Finding-Level Cache

The cache must store normalized findings keyed by:

- `projectHash`
- `relativePath` or project-level scope
- `fileHash` when file-specific
- `ruleId`
- relevant source citation content hashes
- response schema version

The cache must support:

- Reusing unchanged findings across repeated calls.
- Creating `deltaToken` values for session follow-up.
- Marking findings stale when local file hashes or source citation hashes change.
- Returning only changed findings when explicitly requested by `sinceToken`, while still surfacing critical current errors.

### Payload Reuse

The server should avoid returning duplicate large analysis payloads when:

- `project_health` follows `analyze_bun_project`.
- `lint_bun_file` follows `project_health`.
- `check_before_install` follows another dependency planning call for the same packages.

## 12. Security Requirements

- The MCP server must not execute shell commands.
- The MCP server must not mutate the analyzed project.
- The MCP server must not install dependencies.
- The MCP server must not rewrite files.
- The MCP server must not delete lockfiles.
- The MCP server must not read `node_modules`.
- The MCP server must not read secret files.
- The MCP server must restrict network fetches to the official source allowlist.
- The MCP server must sanitize project paths and file paths.
- The MCP server must return suggested commands and edits as structured recommendations only.
- Brief output must not drop safety warnings required for an action.
- TRACE or full output modes must not include secret contents.

## 13. TDD Implementation Workflow

The future implementation must be test-driven.

Required sequence:

1. Update PRD and task tracker before implementation begins.
2. Add failing contract tests for the agent response envelope, finding schema, action schema, citation map, and response budgets.
3. Implement shared contract types and budget helpers.
4. Add failing tests for task-shaped tools before implementing handlers.
5. Implement the minimum tool behavior to pass tests.
6. Add finding-level cache tests before modifying cache internals.
7. Implement finding cache and delta behavior.
8. Update server registration and tool descriptions.
9. Update README usage guidance and migration notes.
10. Run `bun test`.
11. Run `bun run typecheck`.
12. Run `bun run check`.
13. Run live-source tests only when explicitly requested with `LIVE_DOCS=1`.

Default tests must be deterministic and offline.

## 14. Required Test Categories

### Agent Response Contracts

- Valid agent envelope passes.
- Invalid response mode fails.
- Findings require stable IDs, rule IDs, severity, evidence, citation IDs, and fingerprints.
- Actions require kind, risk, approval flag, reason, and citations.
- Citation IDs referenced by findings/actions/examples exist in the top-level map.
- Brief and standard summary budgets are enforced.

### Citation Compaction

- Repeated source URLs are emitted once in the citation map.
- Findings reference citation IDs instead of repeated URL arrays.
- Local project evidence can be mapped without exposing secret contents.

### Structured Actions

- Dependency actions include `command`, `risk`, and `requiresApproval: true`.
- File edit actions include target path and reason without applying edits.
- Verification actions recommend commands without executing them.
- High-risk or destructive actions are either omitted or marked high risk with approval required.

### Task-Shaped Tools

- `project_health` returns brief output by default.
- `project_health` includes only ranked findings and actions unless `full` is requested.
- `check_before_install` returns Bun-native install guidance and npm metadata warnings.
- `check_bun_api_usage` returns a canonical docs-backed answer and one example.
- `lint_bun_file` rejects paths outside the project and ignored files.
- `lint_bun_file` returns only file-relevant findings.

### Change Metadata

- Source-backed release or publish dates populate `sinceDate`.
- Source-backed release versions populate `sinceVersion`.
- Missing evidence omits change metadata rather than guessing.
- `afterAgentTrainingCutoff` is true only when source dates prove it.

### Finding-Level Cache And Delta

- Unchanged file/rule findings reuse cached fingerprints.
- Changed file hashes invalidate affected findings.
- Source citation hash changes invalidate affected source-backed findings.
- Valid `sinceToken` returns new, changed, resolved, and repeated IDs.
- Invalid or expired `sinceToken` produces a warning and current response.
- Critical current errors are still surfaced in delta mode.

### MCP Registration

- New tools are registered with concise descriptions.
- Existing tools remain available.
- Tool descriptions steer agents toward task-shaped tools.
- Input schemas include response mode where required.

### End-To-End Agent Flow

- Health check a fixture project in brief mode.
- Check a Bun API and receive one canonical example.
- Check before installing a package and receive an approval-gated command action.
- Lint one file and receive file-specific findings.
- Re-run health with a delta token and receive compact delta output.

## 15. Acceptance Criteria For Future Implementation

The V2 implementation is complete only when:

- `project_health`, `check_before_install`, `check_bun_api_usage`, and `lint_bun_file` are registered.
- Existing V1 tools remain available.
- New task-shaped tools default to `brief`.
- Brief summaries are less than or equal to 500 characters.
- Standard summaries are less than or equal to 1200 characters.
- Full output is opt-in for new task-shaped tools.
- All findings use the normalized finding schema.
- All actions use the normalized action schema.
- Citations are de-duplicated in a top-level citation map.
- Per-finding repeated source URL arrays are removed from V2 outputs.
- Any suggested command or edit is approval-gated and not executed.
- Source-backed change metadata is included only when supported by official evidence.
- Finding-level cache supports stable fingerprints and delta tokens.
- Project analysis still never reads `node_modules`.
- The server still never mutates analyzed projects or executes local shell commands.
- `bun test` passes.
- `bun run typecheck` passes.
- `bun run check` passes.
- README documents when agents should use each tool.

### Goal Stop Conditions

When this PRD is implemented through a Codex goal, the goal may be marked complete only when all of these are true:

- Every acceptance criterion above is satisfied.
- Every task in `docs/tasks/bun-dev-intel-mcp-agent-output-v2/tracker.md` is marked `done`.
- `Current Task` in the tracker is cleared or set to `none`.
- The final tracker work log records the completed deterministic validation commands and their pass status.
- No known blocker, skipped required test, unresolved compatibility decision, or unimplemented PRD requirement remains.

The goal must not be marked complete when:

- Work is only partially implemented.
- A token, time, or context budget is nearly exhausted.
- A failing test is waived without a PRD change.
- Full output remains the default for new task-shaped tools.
- Change metadata is guessed from model memory instead of official evidence.
- A V1 compatibility break is introduced without an explicit PRD update.

The implementation should stop as `blocked`, not `complete`, when any of these occur:

- An acceptance criterion cannot be met without a product decision or PRD scope change.
- Required official source evidence for change metadata cannot be found or revalidated.
- MCP SDK behavior prevents a required tool, resource, or response field from being exposed as specified.
- A safety requirement conflicts with a requested feature.
- A deterministic quality gate fails and the failure cannot be fixed within the current implementation pass.
- Network or dependency access needed for implementation is denied and no deterministic offline fallback is available.

When blocked, update the tracker with:

- The blocked task ID.
- The exact unmet acceptance criterion or requirement.
- The commands already run and their result.
- The decision or access needed to proceed.

## 16. Suggested Future Project Shape

Suggested added or changed files:

```text
src
├── shared
│   ├── agent-output.ts
│   └── response-budget.ts
├── recommendations
│   ├── actions.ts
│   ├── citations.ts
│   └── finding-normalizer.ts
├── cache
│   └── finding-cache.ts
├── tools
│   ├── project-health.ts
│   ├── check-before-install.ts
│   ├── check-bun-api-usage.ts
│   └── lint-bun-file.ts
└── sources
    └── bun-release-notes.ts
```

Suggested tests:

```text
tests
├── unit
│   ├── shared
│   │   ├── agent-output.test.ts
│   │   └── response-budget.test.ts
│   ├── recommendations
│   │   ├── actions.test.ts
│   │   ├── citations.test.ts
│   │   └── finding-normalizer.test.ts
│   └── cache
│       └── finding-cache.test.ts
├── integration
│   └── tools
│       ├── project-health.test.ts
│       ├── check-before-install.test.ts
│       ├── check-bun-api-usage.test.ts
│       └── lint-bun-file.test.ts
└── e2e
    └── agent-output-v2-flow.test.ts
```

## 17. Source Baseline

The future implementation must revalidate official source URLs before coding:

- Bun docs index: `https://bun.com/docs/llms.txt`
- Bun full docs: `https://bun.com/docs/llms-full.txt`
- Bun runtime API docs under `https://bun.com/docs/runtime/`
- Bun package manager docs under `https://bun.com/docs/pm/`
- Bun test docs under `https://bun.com/docs/test/`
- npm registry metadata at `https://registry.npmjs.org/{packageName}`
- Any official Bun release/changelog source chosen for change metadata
- MCP server/tool/resource docs if registration behavior changes

No implementation may rely on model memory for current Bun behavior.

V2 implementation revalidation completed on 2026-05-12. The exact Bun release/changelog sources selected for change metadata are official Bun blog release pages at `https://bun.com/blog/bun-v{version}` and official Bun repository release pages at `https://github.com/oven-sh/bun/releases/tag/bun-v{version}`. npm registry metadata was verified against public package documents and remains the source for package publish times, dist-tags, deprecation notices, peer dependencies, and engines.

## 18. Open Questions For Later Review

- Should `review_bun_project` return both legacy fields and the V2 envelope, or should it become a strict alias of `project_health`?
- Should `analyze_bun_project` keep full output as its default for compatibility, even if task-shaped tools default to brief?
- What exact official Bun release/changelog source is stable enough for `sinceVersion` and `breaking` metadata?
- Should citation IDs be stable within a response only, or stable across a server session?
- Should delta tokens be process-local only, or persisted in SQLite?
- Should a future shared package define the agent-output contract for other framework MCPs?

## 19. Task Files And Tracker

The implementation task plan is split into small cluster files under `docs/tasks/bun-dev-intel-mcp-agent-output-v2/`.

Start with:

- Task index: `docs/tasks/bun-dev-intel-mcp-agent-output-v2-tasks.md`
- Tracker: `docs/tasks/bun-dev-intel-mcp-agent-output-v2/tracker.md`
