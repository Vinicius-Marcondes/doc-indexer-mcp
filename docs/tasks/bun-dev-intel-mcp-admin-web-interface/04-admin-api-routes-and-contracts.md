# Task 04: Add admin API routes and contracts

## Goal

Expose authenticated admin API routes backed by shared Zod contracts.

## Why

The React UI needs a stable API surface, and backend/frontend contracts should not drift.

## Scope

- Add request and response schemas to `packages/admin-contracts`.
- Add API routes:
  - `POST /api/admin/auth/login`
  - `POST /api/admin/auth/logout`
  - `GET /api/admin/auth/me`
  - `GET /api/admin/overview`
  - `GET /api/admin/kpis`
  - `GET /api/admin/sources`
  - `GET /api/admin/sources/:sourceId`
  - `GET /api/admin/sources/:sourceId/pages`
  - `GET /api/admin/sources/:sourceId/pages/:pageId`
  - `GET /api/admin/sources/:sourceId/chunks/:chunkId`
  - `GET /api/admin/jobs`
  - `GET /api/admin/jobs/:jobId`
  - `POST /api/admin/search`
  - `GET /api/admin/audit-events`
- Add route-level validation and structured errors.
- Add auth and role middleware to protected routes.

## Out Of Scope

- No mutation action routes beyond auth/logout.
- No frontend implementation.
- No Docker changes.

## Required Tests

- Route tests:
  - unauthenticated requests are rejected.
  - viewer can access read routes.
  - invalid query params return stable validation errors.
  - overview route returns contracted shape.
  - search route delegates to retrieval service.
- Contract tests:
  - API responses parse with shared schemas.

## Acceptance Criteria

- Admin API is namespaced under `/api/admin`.
- No route exposes MCP bearer token values.
- Search route uses the same retrieval behavior as MCP docs search.
- Source definitions remain read-only.
