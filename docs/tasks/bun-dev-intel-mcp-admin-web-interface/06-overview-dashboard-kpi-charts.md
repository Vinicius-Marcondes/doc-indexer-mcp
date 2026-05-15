# Task 06: Build overview dashboard and KPI charts

## Goal

Implement the Overview page with operational KPIs and charts for selected time windows.

## Why

The dashboard is the quickest way to know whether indexing and retrieval are healthy.

## Scope

- Add window selector: `1h`, `24h`, `7d`, `30d`.
- Render KPI summaries:
  - sources
  - pages
  - chunks
  - embeddings
  - embedding coverage
  - stale pages
  - tombstoned pages
  - queued jobs
  - running jobs
  - failed jobs
  - searches
  - zero-result rate
  - low-confidence rate
  - stale-result rate when available
  - refresh queued count
- Add charts:
  - searches over time
  - job statuses over time
  - embedding coverage by source
  - failed jobs by type
- Add empty, unavailable, and loading states.

## Out Of Scope

- No source detail page.
- No mutation actions.

## Required Tests

- Frontend tests:
  - window selector updates API request.
  - unavailable KPI is labeled instead of hidden.
  - chart renders seeded data.
  - empty state renders with no data.

## Acceptance Criteria

- Overview can explain the current index state without direct SQL access.
- KPIs are visually scannable.
- 7-day window is supported.
