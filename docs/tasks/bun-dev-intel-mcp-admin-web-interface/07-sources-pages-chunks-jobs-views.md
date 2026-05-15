# Task 07: Build sources, pages, chunks, and jobs views

## Goal

Implement admin views for source health, indexed content, chunks, and refresh jobs.

## Why

Operators need to inspect what is indexed and diagnose failed or stale refresh work.

## Scope

- Sources list page.
- Source detail page with:
  - source metadata
  - health stats
  - pages table
  - recent jobs
- Pages table filters:
  - text query
  - freshness
  - tombstoned status
  - embedding presence
- Page detail view:
  - metadata
  - content hash
  - freshness
  - tombstone state
  - chunk list
- Chunk detail view:
  - heading path
  - content
  - token estimate
  - previous/next chunk links
- Jobs page:
  - status/type/reason/source filters
  - failed-only filter
  - job detail view
  - sanitized error display

## Out Of Scope

- No retry button yet.
- No source refresh/tombstone/purge actions yet.
- No Search Lab.

## Required Tests

- Frontend tests:
  - sources table renders stats.
  - page filters update API query.
  - chunk detail renders heading path.
  - jobs filters update API query.
  - sanitized job error is rendered without secret-like strings.

## Acceptance Criteria

- Source definitions are presented as view-only.
- Content and jobs are paginated.
- Failed job details are useful without exposing secrets.
