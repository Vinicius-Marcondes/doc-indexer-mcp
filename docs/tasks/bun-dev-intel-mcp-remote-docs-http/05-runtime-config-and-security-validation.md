# Task 05 - Add Runtime Configuration And Security Validation

## Goal

Centralize remote HTTP, database, embedding, search-limit, and refresh configuration with strict validation and safe error reporting.

## Motivation

The remote service depends on secrets and deployment-specific configuration. Misconfiguration should fail early and safely, not appear as obscure runtime errors during an agent request.

## Scope

- Add configuration parser module for remote docs service.
- Validate required env vars:
  - `MCP_HTTP_HOST`
  - `MCP_HTTP_PORT`
  - `MCP_BEARER_TOKEN`
  - `DATABASE_URL`
  - `EMBEDDING_PROVIDER`
  - provider-specific settings.
- Validate optional env vars:
  - allowed origins.
  - search limits.
  - refresh intervals.
  - worker concurrency.
- Integrate config into Hono app and future worker paths.

## Out Of Scope

- No database connection implementation beyond typed config values.
- No OpenAI API calls.
- No Docker.

## Behavior Requirements

- Missing token fails startup.
- Empty or weak placeholder token fails startup unless explicitly in test mode.
- Port parses as integer and stays in valid range.
- Search default limit cannot exceed max limit.
- Refresh interval format is validated.
- Secrets are not included in structured errors.

## Tests To Implement First

Add:

- `tests/unit/config/remote-docs-config.test.ts`
  - valid minimal env parses.
  - missing bearer token fails.
  - missing database URL fails.
  - invalid port fails.
  - invalid refresh interval fails.
  - default search limit above max fails.
  - secrets are redacted from error output.

Update Hono tests:

- app uses parsed config for auth/origin/body limit behavior.

## Validation

- `bun test tests/unit/config/remote-docs-config.test.ts`
- Hono app tests.
- `bun run typecheck`
- `bun run check`

## Acceptance Criteria

- Remote service configuration is typed, validated, and redacted.
- HTTP and worker code can consume one config contract.
- Startup failures are clear without leaking secrets.

## Commit Guidance

Commit config parser, config tests, and config integration only.

Suggested message:

```text
feat: validate remote docs runtime configuration
```
