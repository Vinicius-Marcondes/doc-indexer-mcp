# Task 15: Update Docs And AGENTS.md

## Goal

Update repository guidance and deployment documentation for the new architecture.

## Scope

- Update root README.
- Update deployment docs.
- Update AGENTS.md.
- Update environment variable documentation.
- Ensure docs no longer claim the admin console is intentionally split out.

## Out Of Scope

- Do not change runtime code.
- Do not change tests except documentation coverage tests.

## Required Tests

```text
bun test tests/unit/deployment/remote-docs-handoff.test.ts tests/unit/deployment/admin-reintegration-monorepo.test.ts
```

## Acceptance Criteria

- Docs describe apps and packages accurately.
- AGENTS.md reflects new boundaries and working agreements.
- Deployment docs cover MCP HTTP, worker, admin, and Postgres.
- Documentation tests pass.

