# Task 03 - Implement Hono HTTP Shell, Auth, Health, And Readiness

## Goal

Add a thin Hono application shell for the remote server, including bearer authentication, health/readiness routes, request limits, and structured pre-MCP HTTP errors.

## Motivation

Remote HTTP is an externally reachable surface. Authentication, liveness, readiness, and request boundaries must exist before MCP protocol handling is connected.

## Scope

- Add a Hono app factory, for example `src/http/app.ts`.
- Add `src/http.ts` as the future HTTP entrypoint only if startup can be tested safely.
- Implement:
  - `GET /healthz`
  - `GET /readyz`
  - bearer auth middleware for protected routes.
  - origin validation when configured.
  - body size limit for MCP routes.
  - structured JSON errors for rejected HTTP requests.
- Keep `/mcp` as a protected placeholder until Task 04.

## Out Of Scope

- No MCP Streamable HTTP transport yet.
- No docs tools.
- No DB schema.
- No Docker.

## Behavior Requirements

- `GET /healthz` returns liveness without touching Postgres or embedding providers.
- `GET /readyz` uses injectable readiness checks.
- `/mcp` rejects missing bearer token.
- `/mcp` rejects invalid bearer token.
- Tokens in query strings are rejected.
- Authorization headers are never logged.
- Invalid origins are rejected when `DOCS_ALLOWED_ORIGINS` is configured.
- Large request bodies are rejected before MCP handling.

## Tests To Implement First

Add:

- `tests/integration/http/hono-app.test.ts`
  - `GET /healthz` returns ok without auth.
  - `GET /readyz` reports ready when dependency checks pass.
  - `GET /readyz` reports unavailable when dependency checks fail.
  - `/mcp` rejects missing bearer token.
  - `/mcp` rejects invalid bearer token.
  - `/mcp` rejects bearer token in query string.
  - `/mcp` accepts valid bearer token and reaches placeholder handler.
  - invalid `Origin` is rejected when configured.
  - oversized body is rejected.

## Validation

- `bun test tests/integration/http/hono-app.test.ts`
- Existing MCP registration tests.
- `bun run typecheck`
- `bun run check`

## Acceptance Criteria

- Hono is the application framework for the remote HTTP shell.
- Security middleware is covered before MCP protocol handling exists.
- Health/readiness behavior is injectable and deterministic in tests.
- Existing stdio entrypoint remains unaffected.

## Commit Guidance

Commit Hono shell, HTTP tests, and minimal docs updates only.

Suggested message:

```text
feat: add authenticated Hono shell for remote MCP HTTP
```
