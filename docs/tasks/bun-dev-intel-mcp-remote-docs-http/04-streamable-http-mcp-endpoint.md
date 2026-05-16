# Task 04 - Wire Streamable HTTP MCP Endpoint

## Goal

Connect the Hono `/mcp` routes to the selected official MCP Streamable HTTP transport while preserving docs-only remote capability registration.

## Motivation

The remote service must be a real MCP server, not a REST wrapper. Protocol integration must happen through official SDK transport/middleware wherever possible.

## Scope

- Wire `POST /mcp`, `GET /mcp`, and `DELETE /mcp` according to Streamable HTTP requirements.
- Use the remote docs-only server registration path from Task 02.
- Preserve bearer auth and pre-MCP middleware from Task 03.
- Add startup-safe HTTP entrypoint behavior.
- Add structured startup failure handling.

## Out Of Scope

- No docs DB tools yet.
- No ingestion.
- No Docker.
- No deprecated HTTP+SSE compatibility.

## Behavior Requirements

- `/mcp` initializes through Streamable HTTP.
- Remote server advertises docs-only capabilities.
- Project-analysis tools are not reachable through remote HTTP.
- Missing/invalid auth is rejected before MCP transport.
- Protocol stdout/stderr behavior remains safe for local tests.
- Server construction is testable without binding a real port.

## Tests To Implement First

Add:

- `tests/integration/mcp/streamable-http-entrypoint.test.ts`
  - Hono app routes valid authenticated MCP initialization request to transport.
  - Remote capability list excludes local project tools.
  - Missing auth never reaches MCP transport.
  - `GET /mcp` and `DELETE /mcp` are wired according to selected SDK support.
  - Deprecated SSE route is not present.
  - Importing `src/http.ts` has no startup side effects when tested.

Use SDK-level test clients or mocked transport adapters where practical. Do not require external network.

## Validation

- Streamable HTTP focused tests.
- Hono shell tests.
- Existing stdio tests.
- `bun run typecheck`
- `bun run check`

## Acceptance Criteria

- A real Streamable HTTP MCP endpoint exists.
- Remote HTTP exposes only docs-safe capabilities.
- Deprecated transport routes are absent.
- Existing stdio behavior still passes.

## Commit Guidance

Commit MCP HTTP transport integration and tests only.

Suggested message:

```text
feat: connect docs-only MCP server over Streamable HTTP
```
