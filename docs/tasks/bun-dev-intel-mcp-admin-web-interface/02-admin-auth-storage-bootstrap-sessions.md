# Task 02: Add admin auth storage, bootstrap, and sessions

## Goal

Implement admin user storage, password hashing, bootstrap admin creation, session persistence, and route authentication primitives.

## Why

The admin interface includes privileged indexing actions and must not reuse the MCP bearer token.

## Scope

- Add migrations for:
  - `admin_users`
  - `admin_sessions`
  - initial indexes and constraints
- Add auth storage methods.
- Add password hashing and verification helpers.
- Add bootstrap admin creation from env vars.
- Add session creation, lookup, expiry, revocation, and cookie helpers.
- Add authenticated route middleware for Hono.
- Add role guard middleware for `admin`.
- Add login rate-limit storage or a bounded first-pass equivalent.

## Out Of Scope

- No user management UI.
- No admin action routes.
- No OAuth or SSO.

## Required Tests

- Unit tests:
  - password hash is not raw password.
  - valid password verifies.
  - invalid password fails.
  - disabled users cannot create sessions.
  - expired sessions are rejected.
  - revoked sessions are rejected.
  - viewer cannot pass admin role guard.
- Integration tests gated by `TEST_DATABASE_URL`:
  - migrations create auth tables.
  - bootstrap creates first admin only once.
  - session lookup works by token hash.

## Acceptance Criteria

- Login can create a server-side session.
- Logout can revoke the current session.
- Auth middleware rejects unauthenticated requests.
- Role guard rejects viewer mutations.
- No raw session tokens or passwords are stored.
