# Task 10: Add optional Docker deployment and docs

## Goal

Add Docker and documentation for running the admin console as an optional service separate from MCP HTTP and the docs worker.

## Why

The operator should be able to start only MCP services, or add the admin console when needed.

## Scope

- Add Dockerfile or build target for admin console.
- Build React client and serve static assets from the admin Hono server.
- Update compose file with optional `admin-console` service/profile.
- Add env example entries:
  - `ADMIN_HTTP_HOST`
  - `ADMIN_HTTP_PORT`
  - `ADMIN_SESSION_SECRET`
  - `ADMIN_COOKIE_SECURE`
  - `ADMIN_BOOTSTRAP_EMAIL`
  - `ADMIN_BOOTSTRAP_PASSWORD`
  - admin rate-limit/session settings
- Update deployment docs.
- Document local development commands.

## Out Of Scope

- No managed cloud-specific deployment.
- No TLS termination setup beyond documenting reverse-proxy expectation.

## Required Tests

- Unit tests for Docker/deployment config text if existing deployment tests follow that pattern.
- Build admin client.
- Typecheck admin server.
- Run root check.

## Acceptance Criteria

- Compose can run Postgres, MCP HTTP, worker, and optional admin console.
- Admin console can be omitted.
- Docs explain bootstrap admin setup and secret handling.
- No real credentials are committed.
