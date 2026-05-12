# 05 - Resources, Server, QA, And Handoff

Read this file only when working on MCP resources, server registration, stdio startup, end-to-end quality gates, live tests, usage docs, or traceability.

## Task 12.1: Implement `bun-docs://index`

Purpose: Expose cached Bun docs index as a read-only MCP resource.

Implementation guidance:

- Read from cache or fetch through Bun docs adapter if policy allows.
- Return pages, source URL, fetched timestamp, and cache status.
- Do not include excessive full-page content in the index.

Tests to implement first:

- `tests/integration/resources/bun-docs-index-resource.test.ts`
  - Resource is listed.
  - Resource returns cached index.
  - Resource includes cache metadata.
  - Resource handles missing cache through source adapter policy.

Acceptance criteria:

- MCP clients can discover the Bun docs index.
- Output is read-only and cited.

QA impact:

- Lets agents inspect source inventory directly.
- Supports transparent docs search behavior.

## Task 12.2: Implement `bun-docs://page/{slug}`

Purpose: Expose a cached official Bun docs page as a read-only MCP resource.

Implementation guidance:

- Validate slug.
- Resolve slug only to known Bun docs pages.
- Fetch/cache through Bun docs adapter.
- Return title, URL, content, fetched timestamp, content hash, and cache status.

Tests to implement first:

- `tests/integration/resources/bun-docs-page-resource.test.ts`
  - Valid slug returns page content.
  - Invalid slug returns structured error.
  - Page includes source metadata.
  - Disallowed URL cannot be reached through slug manipulation.

Acceptance criteria:

- Resource cannot be used to fetch arbitrary URLs.
- Page content is official and cache-aware.

QA impact:

- Provides deep context without arbitrary web access.
- Makes docs citations auditable.

## Task 12.3: Implement `bun-project://analysis/{projectHash}`

Purpose: Expose cached project analysis through a read-only MCP resource.

Implementation guidance:

- Hash project path for resource identity.
- Store latest analysis result with file hash metadata.
- Do not expose secret file contents.
- Return structured error when analysis is unavailable or stale beyond policy.

Tests to implement first:

- `tests/integration/resources/bun-project-analysis-resource.test.ts`
  - Resource is created after project analysis.
  - Resource returns cached analysis.
  - Resource does not include secret file content.
  - Changed fixture files invalidate or mark analysis stale.

Acceptance criteria:

- Resource reflects latest known analysis.
- Stale status is explicit.
- No sensitive file contents are included.

QA impact:

- Allows MCP clients to re-use analysis without rerunning every tool.
- Keeps project context visible and controlled.

## Task 13.1: Register Server, Tools, And Resources

Purpose: Connect all implemented behavior to an MCP stdio server.

Implementation guidance:

- Create `McpServer` with stable name and version.
- Register all five tools with concise descriptions and schemas.
- Register all three resources.
- Keep server construction separate from process startup so tests can instantiate it.
- Do not add HTTP transport in V1.

Tests to implement first:

- `tests/integration/mcp/server-registration.test.ts`
  - Server can be constructed.
  - Required tools are registered.
  - Required resources are registered.
  - Tool schemas match expected input contracts.
  - Tool descriptions are present and concise.

Acceptance criteria:

- MCP clients can list all expected capabilities.
- Server registration is testable without launching a long-running process.

QA impact:

- Verifies product surface matches the PRD.
- Catches missing or renamed tools/resources before manual testing.

## Task 13.2: Implement Stdio Entrypoint

Purpose: Start the MCP server over stdio for local coding agents.

Implementation guidance:

- Add a minimal CLI entrypoint.
- Connect server to stdio transport.
- Log only to stderr if necessary, never stdout protocol stream.
- Handle startup errors with non-zero exit.
- Do not run any analysis at startup.

Tests to implement first:

- `tests/integration/mcp/stdio-entrypoint.test.ts`
  - Entrypoint imports without side effects when tested.
  - Server connects to mocked stdio transport.
  - Startup failure reports error safely.
  - No analysis or network fetch occurs at startup.

Acceptance criteria:

- Local MCP clients can run the command through Bun.
- Protocol stdout is not polluted with logs.
- Startup remains fast and side-effect-light.

QA impact:

- Ensures the server is usable by real agent clients.
- Prevents MCP protocol failures from stray logs.

## Task 14.1: Add Deterministic End-To-End Tool Flow Tests

Purpose: Verify the server works as a product, not only as separate modules.

Implementation guidance:

- Use mocked source adapters or mocked fetch responses.
- Run through public tool handlers where possible.
- Cover the main workflow: review project, inspect docs, plan dependency, return recommendations.
- Keep network disabled by default.

Tests to implement first:

- `tests/e2e/bun-dev-intel-flow.test.ts`
  - Analyze fixture project.
  - Search mocked Bun docs for TypeScript guidance.
  - Plan adding a dev dependency.
  - Review project and receive top risks.
  - Assert every recommendation has evidence and citations.

Acceptance criteria:

- Main user workflow passes offline.
- E2E output is stable enough for snapshot-style assertions if snapshots are used carefully.
- Failures point to product behavior, not external network state.

QA impact:

- Confirms the MCP server provides useful agent-facing guidance end to end.
- Protects against integration drift between analyzers, sources, cache, and tools.

## Task 14.2: Add Typecheck And Quality Scripts

Purpose: Make quality gates repeatable for future agents.

Implementation guidance:

- Add `typecheck` script using `tsc --noEmit`.
- Add formatting/linting only if chosen explicitly during implementation.
- Ensure `bun test` and `typecheck` are enough for minimum PRD acceptance.
- Document all quality commands.

Tests to implement first:

- No direct product test is required.
- CI or local validation should run `bun test` and `bun run typecheck`.

Acceptance criteria:

- TypeScript catches compile errors.
- Test command is documented.
- Future contributors know the required gates.

QA impact:

- Prevents type regressions.
- Makes handoff to other agents safer.

## Task 14.3: Add Optional Live Source Tests

Purpose: Verify real official source integrations without making default tests flaky.

Implementation guidance:

- Gate live tests behind `LIVE_DOCS=1`.
- Live tests may fetch Bun docs and npm metadata.
- Keep live assertions broad enough to tolerate docs wording changes.
- Never require live tests for normal offline CI.

Tests to implement first:

- `tests/live/bun-docs.live.test.ts`
  - Fetches Bun docs index.
  - Finds at least one docs page.
- `tests/live/npm-registry.live.test.ts`
  - Fetches metadata for a stable package such as `typescript`.
  - Finds a latest dist-tag.

Acceptance criteria:

- Default `bun test` skips live tests unless explicitly enabled.
- Live tests verify source adapters against real services.
- Live failures do not block offline development unless live mode is requested.

QA impact:

- Catches API/source format drift.
- Keeps normal quality gates deterministic.

## Task 15.1: Add Usage Documentation

Purpose: Explain how to run and configure the MCP server after implementation.

Implementation guidance:

- Add README usage section or dedicated docs page.
- Include MCP client config example using Bun command.
- Explain that the server is read-only and does not execute shell commands.
- Document cache location and live-source behavior.
- Document test commands.

Tests to implement first:

- No product test is required.
- If docs lint exists, include this page.

Acceptance criteria:

- A developer can configure the server in a local MCP client.
- Safety boundaries are clearly documented.
- Quality commands are visible.

QA impact:

- Reduces misuse after implementation.
- Makes operational behavior clear for future agents.

## Task 15.2: Add Implementation Traceability Checklist

Purpose: Ensure each PRD requirement maps to code and tests.

Implementation guidance:

- Create a checklist mapping PRD tools, resources, security requirements, cache requirements, and test categories to implementation artifacts.
- Mark each item with test file references.
- Keep the checklist updated before final handoff.

Tests to implement first:

- No automated test is required unless docs lint exists.

Acceptance criteria:

- Every PRD acceptance criterion has an implementation and test reference.
- Unimplemented items are clearly marked.
- Handoff summary can cite the checklist.

QA impact:

- Prevents silent scope gaps.
- Helps reviewers audit completeness quickly.
