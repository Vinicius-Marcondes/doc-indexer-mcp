# Task 02 - Partition Docs-Only Remote Capabilities From Local Stdio Capabilities

## Goal

Create a clean server registration boundary so the remote HTTP server can expose docs-only tools while the existing stdio server keeps local project-analysis capabilities.

## Motivation

A remote server cannot inspect project files on agent machines. Exposing existing `projectPath` tools over HTTP would create a misleading and risky API. The architecture needs explicit capability partitioning before HTTP transport is added.

## Scope

- Extract or add registration functions for:
  - local/full capabilities used by stdio.
  - remote docs-only capabilities used by HTTP.
- Keep existing local tool names and resources unchanged.
- Define a remote capability manifest for docs tools/resources, initially with placeholders or existing docs search compatibility only if safe.
- Ensure project-analysis tools are excluded from the remote manifest.

## Out Of Scope

- No Hono server.
- No Streamable HTTP wiring.
- No new docs DB retrieval yet.
- No removal of existing tools.

## Architecture Requirements

- Reuse `src/server.ts` registration style.
- Keep capability manifests testable without starting a process.
- Avoid duplicating tool metadata manually in multiple places when a small shared helper is sufficient.
- Do not move analyzers or local project tooling into remote modules.

## Tests To Implement First

Create or extend:

- `tests/integration/mcp/server-registration.test.ts`
  - Local/full registration still includes current tools.
  - Remote/docs registration does not include tools with `projectPath` inputs.
  - Remote/docs registration includes only docs-safe tools/resources available at this stage.
  - Tool descriptions are present and concise.

Potential new test:

- `tests/integration/mcp/remote-docs-registration.test.ts`
  - Remote manifest can be built without DB/network startup.
  - Remote manifest excludes local project resources.

## Validation

- Focused MCP registration tests.
- Existing stdio entrypoint tests.
- `bun run typecheck`
- `bun run check`

## Acceptance Criteria

- Remote capabilities are explicitly docs-only.
- Existing stdio registration behavior is unchanged.
- Future HTTP work can connect the remote registration path without local analyzer exposure.

## Commit Guidance

Commit server registration refactor and tests only.

Suggested message:

```text
refactor: partition local and remote MCP capabilities
```
