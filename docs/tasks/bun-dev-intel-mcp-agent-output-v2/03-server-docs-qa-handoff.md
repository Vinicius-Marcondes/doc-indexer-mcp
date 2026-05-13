# 03 - Server Registration, Docs, QA, And Handoff

Read this file only when working on MCP registration, resources, end-to-end tests, README updates, migration notes, or final validation.

## Task 4.1: Register V2 Tools And Finding Resource

Purpose: Expose the V2 task-shaped tools and normalized findings resource through the MCP server.

Implementation guidance:

- Register:
  - `project_health`
  - `check_before_install`
  - `check_bun_api_usage`
  - `lint_bun_file`
- Keep V1 tools registered.
- Add `bun-project://findings/{projectHash}` if finding cache is implemented.
- Use concise tool descriptions that steer agents toward task-shaped calls.
- Keep server construction testable without process startup.
- Do not add HTTP transport.

Tests to implement first:

- `tests/integration/mcp/server-registration.test.ts`
  - New tools are listed.
  - Existing tools remain listed.
  - V2 tool schemas include response mode.
  - Finding resource template is listed when implemented.
  - Tool descriptions are concise and task-oriented.

Acceptance criteria:

- MCP clients can discover both V1 compatibility tools and V2 task-shaped tools.
- Registration remains side-effect-light.

QA impact:

- Makes the improved product surface available to real agents.

## Task 4.2: Add V2 End-To-End Agent Flow Tests

Purpose: Verify the V2 behavior as an agent workflow rather than isolated modules.

Implementation guidance:

- Use mocked official sources and mocked npm registry responses.
- Avoid live network access by default.
- Run through public tool handlers where possible.
- Cover compact defaults, citation maps, actions, and delta behavior.

Tests to implement first:

- `tests/e2e/agent-output-v2-flow.test.ts`
  - Health check a fixture project in brief mode.
  - Check a Bun API and receive one canonical example.
  - Check before installing a dev dependency and receive an approval-gated command action.
  - Lint one file and receive file-specific findings.
  - Re-run health with a delta token and receive compact delta output.
  - Assert all citation IDs resolve in the top-level citation map.

Acceptance criteria:

- Main V2 workflow passes offline.
- Outputs are compact enough for agent planning.
- Suggested actions are structured and not executed.

QA impact:

- Protects the actual behavior this PRD is meant to improve.

## Task 4.3: Update README And Migration Notes

Purpose: Tell agents and developers which tool to use for each workflow.

Implementation guidance:

- Update README with a "Which tool should an agent call?" table.
- Document response modes.
- Document that full raw analysis is opt-in.
- Document citation maps and action safety.
- Explain that commands are recommendations only.
- Include migration notes from `review_bun_project` to `project_health`.
- Document `LIVE_DOCS=1` for live source checks if source adapters change.

Tests to implement first:

- No product test is required.
- If docs linting exists later, include README in it.

Acceptance criteria:

- A developer configuring Claude or another MCP client can understand the V2 tool surface.
- README does not imply the MCP server mutates files or runs commands.
- Migration guidance is clear enough for existing users.

QA impact:

- Reduces misuse of `analyze_bun_project` for every task.

## Task 4.4: Run Final Deterministic Quality Gate

Purpose: Close the V2 implementation with repeatable validation.

Implementation guidance:

- Run `bun test`.
- Run `bun run typecheck`.
- Run `bun run check`.
- Run live-source tests only if explicitly requested.
- Update the tracker with commands and pass/fail status.
- Keep final notes short and link the most important artifacts.

Tests to implement first:

- No new tests are required in this final task.
- It validates all tests added by earlier tasks.

Acceptance criteria:

- Deterministic local quality gate passes.
- Tracker records final validation.
- No implementation task remains in progress.

QA impact:

- Provides a clean handoff point for future agents and maintainers.
