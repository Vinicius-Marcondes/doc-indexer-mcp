# Task 04 - Improve Worker Logs And Deployment Docs

## Goal

Make worker failures diagnosable without exposing secrets or large payloads, and document normal monitoring/recovery behavior.

## Motivation

The current worker log line `Docs worker failed to run` hides the job id, job type, source, and structured failure code. Operators cannot tell whether the issue is an embedding provider, duplicate write, stale running job, or config problem without querying the database.

## Scope

- Improve worker logging for per-job failures and recovery events.
- Include safe job context in logs.
- Keep startup config errors concise and safe.
- Document monitoring commands for:
  - job status.
  - content counts.
  - missing embeddings.
  - embedding model/version.
  - stale running jobs.
- Document `DOCS_REFRESH_RUNNING_TIMEOUT_SECONDS`.
- Update deployment docs and README only where useful.

## Out Of Scope

- No structured logging dependency.
- No metrics endpoint.
- No OpenTelemetry.
- No admin dashboard.
- No full monitoring stack.

## Behavior Requirements

- Failure logs include job id, source id, job type, error code, and safe message.
- Logs never include API keys, bearer tokens, raw authorization headers, full embedding vectors, or full page content.
- Recovery logs include how many stale jobs were marked failed.
- Documentation explains that the worker container can be `Up` while sleeping between cycles.

## Tests To Implement First

Add or update:

- `tests/integration/docs/refresh/docs-worker.test.ts`
  - worker emits or exposes safe job failure details through an injectable logger or testable log helper.

- `tests/unit/deployment/remote-docs-handoff.test.ts` or `tests/unit/deployment/docker-config.test.ts`
  - deployment docs mention monitoring, stale running recovery, and the timeout env variable.

If direct log assertions would over-couple tests, extract a small formatting helper and test that helper.

## Validation

- `bun test tests/integration/docs/refresh/docs-worker.test.ts`
- `bun test tests/unit/deployment/remote-docs-handoff.test.ts tests/unit/deployment/docker-config.test.ts`
- `bun run typecheck`
- `bun run check`

## Acceptance Criteria

- Operators can identify failed worker jobs from logs without database spelunking.
- Monitoring and recovery docs reflect the new worker behavior.
- No secrets or full payloads are logged.

## Commit Guidance

Commit logging and documentation updates only.

Suggested message:

```text
docs: document and log docs worker recovery
```
