# Task 09: Add guarded admin actions and audit events

## Goal

Add admin mutation workflows for source refresh, failed job retry, source tombstone, and purge plus reindex, all with audit events.

## Why

Manual operations are a core reason for the admin interface, but they need guardrails and traceability.

## Scope

- Add admin audit storage and route integration if not already complete.
- Add backend routes:
  - `POST /api/admin/sources/:sourceId/actions/refresh`
  - `POST /api/admin/jobs/:jobId/actions/retry`
  - `POST /api/admin/sources/:sourceId/actions/tombstone`
  - `POST /api/admin/sources/:sourceId/actions/purge-reindex`
- Add source-level tombstone storage helper.
- Add admin UI action panels and dialogs.
- Require typed source ID confirmation for tombstone and purge/reindex.
- Hide mutation actions for viewer role.
- Enforce admin role server-side.
- Add audit events for all mutation attempts and outcomes.

## Out Of Scope

- No arbitrary physical delete.
- No source definition editing.
- No cron scheduling UI.

## Required Tests

- Backend tests:
  - viewer cannot call mutation routes.
  - source refresh enqueues manual source job.
  - retry creates a new queued job and leaves original failed job unchanged.
  - tombstone marks source pages with admin reason.
  - purge/reindex tombstones and enqueues source refresh.
  - audit event is created for each mutation.
- Frontend tests:
  - viewer does not see action buttons.
  - confirmation requires typed source ID.
  - successful action invalidates relevant queries.

## Acceptance Criteria

- Admin actions are guarded by role, confirmation, source policy, and audit.
- Destructive workflows use tombstone semantics in V1.
- Full purge plus reindex is available as a controlled workflow.
