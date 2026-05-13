# 00 - Agent Contracts And Response Budgets

Read this file only when working on official-source revalidation, shared V2 output contracts, response budgets, finding normalization, or structured action contracts.

## Task 0.1: Revalidate V2 Official Source Assumptions

Purpose: Confirm the official source URLs needed for V2 before implementing change metadata.

Implementation guidance:

- Revalidate Bun docs index and full docs URLs.
- Revalidate any official Bun release or changelog source before adding it to the allowlist.
- Confirm npm registry metadata still exposes publish times and dist-tags needed by dependency checks.
- Update the PRD if the exact release/changelog source differs from the proposed source baseline.
- Do not add broad web search.

Tests to implement first:

- No product tests are required before documentation revalidation.
- If source allowlist changes are made later, add tests in the relevant source adapter task.

Acceptance criteria:

- Exact official sources for change metadata are documented.
- Any new source class has a clear allowlist requirement.
- Unsupported change metadata remains omitted rather than guessed.

QA impact:

- Prevents the "changed since cutoff" feature from becoming model-memory-based advice.

## Task 1.1: Define Agent Response Envelope Contracts

Purpose: Add shared schemas and types for V2 agent-ready outputs.

Implementation guidance:

- Create a shared module such as `src/shared/agent-output.ts`.
- Define `responseMode`, citation map, finding, action, example, change metadata, delta, and envelope schemas.
- Use Zod v4.
- Keep schemas strict.
- Include `schemaVersion: "agent-output-v1"`.
- Ensure all citation references can be validated against the top-level citation map.

Tests to implement first:

- `tests/unit/shared/agent-output.test.ts`
  - Valid brief envelope passes.
  - Invalid response mode fails.
  - Finding without evidence fails.
  - Action without approval flag fails.
  - Referenced missing citation ID fails helper validation.
  - Change metadata without evidence fails or is normalized away.

Acceptance criteria:

- V2 output contracts are reusable across tools.
- Contracts do not depend on Bun-specific implementation details except `framework: "bun"` values in Bun findings.
- Invalid citation references are caught in tests.

QA impact:

- Gives future framework MCPs a stable mental model.
- Makes output validation explicit instead of relying on TypeScript shape alone.

## Task 1.2: Implement Response Budget Helpers

Purpose: Enforce compact defaults for agent-facing tools.

Implementation guidance:

- Create a helper such as `src/shared/response-budget.ts`.
- Implement budgets for `brief`, `standard`, and `full`.
- Enforce summary character limits:
  - `brief`: less than or equal to 500 characters.
  - `standard`: less than or equal to 1200 characters.
- Enforce count limits:
  - `brief`: at most three findings and three actions.
  - `standard`: at most eight findings and five actions.
- Full mode should not silently drop relevant findings, but it should still use citation maps.
- Budget helpers should rank by severity, actionability, task relevance, and stable ID.

Tests to implement first:

- `tests/unit/shared/response-budget.test.ts`
  - Brief summary is truncated or regenerated within budget.
  - Brief limits findings and actions.
  - Standard limits findings and actions.
  - Error severity findings outrank warnings and info.
  - Full mode preserves all findings.

Acceptance criteria:

- New task-shaped tools can default to brief safely.
- Budgeting is deterministic.
- Critical findings are not dropped behind lower-severity items.

QA impact:

- Directly addresses oversized payloads.
- Makes the server responsible for filtering instead of the agent.

## Task 1.3: Normalize Recommendations Into Findings And Actions

Purpose: Convert V1 recommendation objects into V2 findings and structured actions.

Implementation guidance:

- Create modules such as:
  - `src/recommendations/finding-normalizer.ts`
  - `src/recommendations/actions.ts`
- Map V1 recommendation severities to V2 finding severities.
- Convert `recommendedAction` strings into structured actions only when safe and clear.
- Command actions must set `requiresApproval: true`.
- Edit actions must describe target files and intent without mutating files.
- Generate stable finding fingerprints from project hash, file path or scope, rule ID, evidence, and source hashes.

Tests to implement first:

- `tests/unit/recommendations/finding-normalizer.test.ts`
  - Missing `@types/bun` recommendation becomes a warning finding.
  - Mixed lockfiles recommendation becomes a warning finding.
  - Evidence and citation IDs are preserved.
  - Fingerprints are stable for identical input.
  - Fingerprints change when evidence changes.
- `tests/unit/recommendations/actions.test.ts`
  - `bun add -d @types/bun` becomes a command action with approval required.
  - Lockfile cleanup is high or medium risk and approval-gated.
  - Verification commands are `verify` actions, not executed commands.

Acceptance criteria:

- Findings and actions are generated consistently from existing rules.
- Existing recommendation logic is reused where sensible.
- The MCP server still does not execute or apply actions.

QA impact:

- Turns advisory text into safer agent-executable plans.
- Reduces ambiguity between "the MCP said something" and "what should I do next".
