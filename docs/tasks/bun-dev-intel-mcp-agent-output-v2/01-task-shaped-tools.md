# 01 - Task-Shaped Tools

Read this file only when working on V2 MCP tool handlers or adapting existing tool handlers to the V2 response contract.

## Task 2.1: Implement `project_health`

Purpose: Provide the broad project scan as a compact, ranked, agent-ready packet.

Implementation guidance:

- Validate `projectPath`, `focus`, `responseMode`, `sinceToken`, and `forceRefresh`.
- Reuse existing local analysis and recommendation rules.
- Return the V2 agent response envelope.
- Default `responseMode` to `brief`.
- Include `projectProfile`, `projectHash`, and `detailResource` where available.
- Include only task-relevant findings and actions in brief/standard modes.
- Support `sinceToken` once delta behavior exists; until then return a warning if the token cannot be honored.

Tests to implement first:

- `tests/integration/tools/project-health.test.ts`
  - Defaults to brief mode.
  - Brief summary is within 500 characters.
  - Mixed lockfiles fixture returns a ranked lockfile finding.
  - TypeScript focus returns TypeScript-specific findings.
  - Full mode includes detail resource or full relevant detail.
  - Recommended validation commands are actions and are not executed.

Acceptance criteria:

- `project_health` is the preferred broad-scan tool for agents.
- It does not dump raw source analysis by default.
- It preserves evidence, citations, and confidence.

QA impact:

- Replaces large planning payloads with focused next-action guidance.

## Task 2.2: Implement `check_before_install`

Purpose: Provide pre-install package guidance with npm metadata and Bun project context.

Implementation guidance:

- Validate package names, dependency type, response mode, and project path.
- Reuse or refactor `plan_bun_dependency` internals.
- Fetch npm metadata through the existing registry adapter.
- Include deprecation, peer dependency, engine, and publish-time signals.
- Include command action recommendations such as `bun add`, `bun add -d`, or `bun add --optional`.
- Warn when the project is not clearly Bun-first.
- Do not install packages.

Tests to implement first:

- `tests/integration/tools/check-before-install.test.ts`
  - Runtime dependency returns a `bun add` command action.
  - Dev dependency returns a `bun add -d` command action.
  - Deprecated package returns a warning finding.
  - Peer dependency metadata returns a warning finding.
  - Engine metadata returns a review finding.
  - Non-Bun project context lowers confidence or warns.
  - Brief output stays within budget.

Acceptance criteria:

- Agents can call this before editing `package.json` or lockfiles.
- npm metadata is cited through citation IDs.
- Suggested install commands are approval-gated actions.

QA impact:

- Reduces stale dependency and package-manager mistakes.

## Task 2.3: Implement `check_bun_api_usage`

Purpose: Answer whether a Bun API usage is current and show a canonical pattern.

Implementation guidance:

- Validate `apiName`, optional `projectPath`, optional `usageSnippet`, optional `agentTrainingCutoff`, response mode, and `forceRefresh`.
- Search official Bun docs through the docs adapter.
- Use release/changelog source only after Task 0.1 confirms an official source.
- Return one canonical example in brief or standard mode when docs support it.
- Classify provided snippets as `current`, `outdated`, `risky`, or `unknown` only when evidence supports the classification.
- Populate change metadata only with source-backed dates or versions.

Tests to implement first:

- `tests/integration/tools/check-bun-api-usage.test.ts`
  - `Bun.serve` query returns a docs-backed finding.
  - API-shaped query returns at most one example in brief mode.
  - Unknown API returns low confidence and no fabricated guidance.
  - Provided snippet classification is `unknown` when docs evidence is insufficient.
  - `agentTrainingCutoff` only affects output when source dates prove recency.

Acceptance criteria:

- Agents can ask about a specific API without reading broad docs search output.
- Canonical examples are concise and cited.
- Change metadata is source-backed or omitted.

QA impact:

- Directly addresses agents with stale Bun API memory.

## Task 2.4: Implement `lint_bun_file`

Purpose: Return Bun-specific findings for one file the agent is about to edit.

Implementation guidance:

- Validate `projectPath`, `filePath`, and response mode.
- Resolve file path inside the project boundary.
- Reject `node_modules`, ignored output, generated files, secret-like files, and binary files.
- Use existing TypeScript AST analyzers for imports and Bun globals.
- Include project-level context only when it affects the file, such as missing Bun types for detected Bun globals.
- Return precise locations when available.
- Return edit actions only as recommendations.

Tests to implement first:

- `tests/integration/tools/lint-bun-file.test.ts`
  - File with `Bun.serve` returns Bun API and type-related findings.
  - File importing `bun:test` returns test-related findings.
  - Path outside project fails.
  - `node_modules` path fails or is ignored.
  - Secret-like file path fails.
  - Brief mode returns only file-relevant findings.

Acceptance criteria:

- Tool output is file-scoped and compact.
- It does not trigger a full project dump.
- Safety boundaries match existing analyzer policy.

QA impact:

- Gives agents precise guidance before editing a file.

## Task 2.5: Adapt Existing Tools For V2 Compatibility

Purpose: Keep V1 tool surface available while steering agents toward V2 outputs.

Implementation guidance:

- Add `responseMode` or `detail` to existing tools only where useful.
- Preserve `analyze_bun_project` as the full diagnostic tool.
- Consider making `review_bun_project` call `project_health` internally.
- Update `plan_bun_dependency` to expose structured actions or delegate to shared planner logic.
- Update `search_bun_docs` and `get_bun_best_practices` to support citation maps in V2 mode.
- Avoid breaking existing tests unless the tracker records an intentional compatibility update.

Tests to implement first:

- Existing V1 integration tests should keep passing or be intentionally updated.
- Add compatibility tests:
  - Existing tools remain registered.
  - `review_bun_project` returns V2 envelope when requested.
  - `plan_bun_dependency` returns structured action data in V2 mode.
  - Tool descriptions prefer task-shaped tools for common workflows.

Acceptance criteria:

- Existing clients are not stranded.
- New agents have clearer tool choices.
- Shared internals avoid duplicate dependency or project-health logic.

QA impact:

- Keeps migration safe while improving behavior for new calls.
