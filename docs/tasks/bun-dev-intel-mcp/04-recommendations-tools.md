# 04 - Recommendations And MCP Tools

Read this file only when working on recommendation rules, confidence calculation, or public MCP tool handlers.

## Task 10.1: Implement Recommendation Rules

Purpose: Convert project facts and source evidence into actionable recommendations.

Implementation guidance:

- Implement rules as small pure functions where possible.
- Each rule must return recommendation objects with stable IDs.
- Required rules:
  - Missing `@types/bun` when Bun APIs are used.
  - Missing `types: ["bun"]` when Bun types are needed.
  - Bun-relevant TypeScript compiler options missing or divergent.
  - Legacy `bun.lockb`.
  - Mixed lockfiles.
  - Missing or non-Bun test script when `bun:test` is present.
  - Bun-native install command for dependency plans.
  - Deprecation, peer dependency, and engine warnings from npm metadata.
- Include source citations from docs, npm registry, or local project evidence.

Tests to implement first:

- `tests/unit/recommendations/rules.test.ts`
  - Each required rule fires for a matching fixture.
  - Each required rule does not fire for a compliant fixture.
  - Every recommendation has ID, severity, title, detail, evidence, and source references.
  - Recommendations are stable in order or explicitly sorted.

Acceptance criteria:

- Recommendations are deterministic.
- No recommendation lacks evidence.
- Severity levels are consistent across rules.

QA impact:

- Converts raw analysis into usable agent guidance.
- Reduces risk of noisy or unsupported advice.

## Task 10.2: Implement Confidence Calculation

Purpose: Make evidence quality visible to agents.

Implementation guidance:

- Use `high` when official source and local evidence agree.
- Use `medium` when official source exists but project evidence is incomplete.
- Use `low` when only stale cache is available, parsing failed, or evidence is ambiguous.
- Apply confidence at response level and optionally per recommendation.
- Include warnings when confidence is lowered.

Tests to implement first:

- `tests/unit/recommendations/confidence.test.ts`
  - High confidence with fresh official docs and local evidence.
  - Medium confidence with fresh docs and partial project data.
  - Low confidence with stale cache.
  - Low confidence with parse failures.
  - Confidence warnings are included.

Acceptance criteria:

- Confidence is not arbitrary.
- Stale cache and incomplete evidence visibly affect outputs.
- Agents can decide whether to ask for confirmation or proceed.

QA impact:

- Makes recommendation risk explicit.
- Prevents overconfident guidance from partial evidence.

## Task 11.1: Implement `analyze_bun_project`

Purpose: Expose full project analysis through MCP.

Implementation guidance:

- Validate input with Zod.
- Use safe path handling.
- Run manifest, lockfile, config, source discovery, AST, and test analyzers.
- Compose recommendations from project findings.
- Return shared response metadata.
- Do not fetch external docs unless needed for cited recommendations.

Tests to implement first:

- `tests/integration/tools/analyze-bun-project.test.ts`
  - Valid fixture returns project profile.
  - Missing project path fails validation.
  - `node_modules` fixture is not read.
  - Missing `@types/bun` produces recommendation.
  - Mixed lockfiles produce warning.
  - Bun API usage appears in `sourceAnalysis`.

Acceptance criteria:

- Tool output matches PRD fields.
- Tool is read-only.
- Tool produces useful project facts even when some files are missing.

QA impact:

- Provides the base intelligence packet for all other behavior.
- Verifies local analysis works through the public MCP tool boundary.

## Task 11.2: Implement `search_bun_docs`

Purpose: Expose official Bun docs search through MCP.

Implementation guidance:

- Validate query and optional topic.
- Use Bun docs adapter.
- Include cache metadata.
- Include citations for every result.
- Return warning instead of fabricated content when no source exists.

Tests to implement first:

- `tests/integration/tools/search-bun-docs.test.ts`
  - TypeScript query returns TypeScript docs result from mocked docs.
  - Lockfile query returns lockfile docs result from mocked docs.
  - Invalid topic fails validation.
  - Network failure plus stale cache returns stale result with warning.
  - No cache plus fetch failure returns structured error.

Acceptance criteria:

- Tool returns relevant official docs snippets.
- Tool never searches outside allowlisted sources.
- Cache status is visible in output.

QA impact:

- Gives agents a current documentation lookup surface.
- Keeps guidance source-backed.

## Task 11.3: Implement `get_bun_best_practices`

Purpose: Return topic-specific Bun guidance, optionally tailored to a project.

Implementation guidance:

- Validate topic enum.
- Fetch relevant official docs through docs adapter.
- If `projectPath` is provided, include project analysis.
- Run recommendation rules for requested topic.
- Avoid generic essays; return action-oriented recommendations.

Tests to implement first:

- `tests/integration/tools/get-bun-best-practices.test.ts`
  - TypeScript topic returns Bun types and compiler option guidance.
  - Lockfile topic returns `bun.lock` guidance.
  - Tests topic returns `bun:test` guidance.
  - Project-tailored response includes project fit.
  - Unknown topic fails validation.

Acceptance criteria:

- Each PRD topic is supported.
- Responses include official citations.
- Project-tailored responses differ from generic topic responses when evidence exists.

QA impact:

- Helps agents plan before editing.
- Reduces reliance on memory for Bun conventions.

## Task 11.4: Implement `plan_bun_dependency`

Purpose: Produce Bun-native dependency install plans with metadata warnings.

Implementation guidance:

- Validate package names and dependency type.
- Analyze project package manager context.
- Fetch npm metadata for each package.
- Produce one install command when possible.
- Include peer dependency, engine, and deprecation warnings.
- Do not run install command.

Tests to implement first:

- `tests/integration/tools/plan-bun-dependency.test.ts`
  - Runtime dependency produces `bun add`.
  - Dev dependency produces `bun add -d`.
  - Multiple packages produce a single coherent command.
  - Deprecated package returns warning.
  - Peer conflict returns warning.
  - Missing package returns structured error.
  - Non-Bun project context lowers confidence or warns.

Acceptance criteria:

- Output is command guidance only.
- npm metadata is cited.
- Project package manager context affects warnings.

QA impact:

- Prevents stale dependency choices.
- Makes dependency changes reviewable before execution.

## Task 11.5: Implement `review_bun_project`

Purpose: Aggregate analysis and recommendations into an agent-ready context packet.

Implementation guidance:

- Validate focus enum.
- Run `analyze_bun_project` logic internally.
- Pull docs and metadata only as needed for the requested focus.
- Return summary, project profile, key risks, recommended next actions, validation commands for the agent, sources, and confidence.
- Validation commands are text recommendations only.

Tests to implement first:

- `tests/integration/tools/review-bun-project.test.ts`
  - `focus: "all"` returns summary and key risks.
  - `focus: "typescript"` returns TypeScript-specific findings.
  - `focus: "dependencies"` includes package-manager and dependency context.
  - Recommended validation commands are not executed.
  - Missing evidence lowers confidence.

Acceptance criteria:

- Tool output can be pasted into an agent planning step.
- It highlights top risks rather than dumping all raw data.
- It preserves links to detailed analysis and sources.

QA impact:

- Improves planning quality for coding agents.
- Reduces chance that agents start implementation without checking project state.
