# Task 23 - Add Docker And Deployment Configuration

## Goal

Make the remote docs MCP server deployable as a Dockerized service with a separate worker and Postgres/pgvector.

## Motivation

The target deployment is a VPS or container runtime. Deployment artifacts must reflect the architecture: Hono MCP server, docs worker, and Postgres.

## Scope

- Add Dockerfile.
- Add compose example for:
  - `mcp-http-server`
  - `docs-worker`
  - `postgres-pgvector`
- Add env example without secrets.
- Add startup commands:
  - `bun src/http.ts`
  - `bun src/docs-worker.ts`
- Add migration command documentation.
- Add readiness/health wiring for container checks where practical.

## Out Of Scope

- No production secret management beyond env docs.
- No cloud-specific Terraform/IaC.
- No TLS termination implementation.

## Security Requirements

- Do not commit real tokens, API keys, or database credentials.
- Compose example must use placeholders.
- Public deployment docs must state TLS/proxy expectation.
- HTTP service must require bearer token in deployment examples.

## Tests To Implement First

Add:

- `tests/unit/deployment/docker-config.test.ts`
  - Dockerfile exists.
  - compose example defines server, worker, and Postgres services.
  - compose example does not contain real-looking secrets.
  - server command starts HTTP entrypoint.
  - worker command starts worker entrypoint.
  - required env variable names are documented.

If Docker is available in CI/local validation, optionally add an opt-in smoke test for image build. Keep default tests deterministic and offline.

## Validation

- Deployment config tests.
- `bun run typecheck`
- `bun run check`

## Acceptance Criteria

- A developer can see how to run the remote docs stack locally.
- Server and worker are separate services.
- Secrets are placeholders only.
- Deployment docs match config parser requirements.

## Commit Guidance

Commit Docker/deployment files, env example, docs, and tests only.

Suggested message:

```text
chore: add Docker deployment for remote docs MCP stack
```
