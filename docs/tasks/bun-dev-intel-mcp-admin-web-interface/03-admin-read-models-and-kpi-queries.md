# Task 03: Add admin read models and KPI queries

## Goal

Create tested backend read models for dashboard, source, page, chunk, job, retrieval, and audit data.

## Why

The UI should not embed SQL or infer operational state client-side. KPI calculations need centralized, tested definitions.

## Scope

- Add admin storage/read model module.
- Add overview KPI query for `1h`, `24h`, `7d`, and `30d`.
- Add source health query:
  - page count
  - chunk count
  - embedding count
  - embedding coverage
  - stale pages
  - tombstoned pages
  - oldest fetched page
  - newest indexed page
  - latest successful and failed jobs
- Add page list and page detail queries.
- Add chunk detail query.
- Add job list and job detail queries.
- Add retrieval KPI query:
  - searches
  - zero-result rate
  - low-confidence rate
  - refresh queued count
  - stale-result rate when telemetry field exists
- Add audit read query placeholder if audit table already exists from auth task.

## Out Of Scope

- No HTTP routes.
- No frontend UI.
- No mutation actions.

## Required Tests

- Unit tests for window parsing and KPI math.
- Postgres integration tests gated by `TEST_DATABASE_URL` with seeded data for:
  - source stats
  - page freshness
  - embedding coverage
  - job status counts
  - retrieval event rates

## Acceptance Criteria

- KPI definitions are documented in test names or helper comments.
- Queries use bounded pagination for list endpoints.
- Stale-result KPI is either implemented from telemetry or explicitly returned as unavailable.
