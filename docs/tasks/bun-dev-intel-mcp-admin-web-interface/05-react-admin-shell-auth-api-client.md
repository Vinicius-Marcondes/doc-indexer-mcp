# Task 05: Build React admin shell, auth flow, and API client

## Goal

Create the React 19 admin app foundation with login, authenticated routing, API client, and layout.

## Why

Feature pages should share a consistent shell, session state, error handling, and API integration.

## Scope

- Add React app shell with navigation:
  - Overview
  - Sources
  - Jobs
  - Search Lab
  - Audit
- Add login page.
- Add authenticated route guard.
- Add `/me` session bootstrap.
- Add logout flow.
- Add API client using shared contracts.
- Add React Query provider and cache invalidation helpers.
- Add base visual system:
  - typography
  - tables
  - badges
  - buttons
  - forms
  - dialogs
  - loading states
  - error states

## Out Of Scope

- No KPI charts.
- No full source/job/search pages.
- No mutation action dialogs.

## Required Tests

- Frontend tests:
  - login form renders and validates.
  - auth guard redirects anonymous users.
  - shell navigation renders after authenticated `/me`.
  - logout clears session state.
- Typecheck frontend workspace.

## Acceptance Criteria

- UI has no public route to admin pages without session.
- Viewer/admin role is available in client state.
- Layout is operational and compact.
- No secret is stored in frontend code or environment output.
