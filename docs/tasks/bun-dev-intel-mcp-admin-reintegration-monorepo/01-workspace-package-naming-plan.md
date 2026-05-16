# Task 01: Workspace Package Naming Plan

## Goal

Choose internal workspace package names and document the dependency direction before changing the package graph.

## Scope

- Decide package names for docs-domain, db, contracts, admin-contracts, and config.
- Document whether names stay under `@bun-dev-intel/*` or move to another internal namespace.
- Record allowed and disallowed dependency directions.
- Add tests or documentation checks that encode the naming plan.

## Out Of Scope

- Do not create workspace packages yet unless needed for a test fixture.
- Do not move source files.
- Do not import admin source.

## Required Tests

```text
bun test tests/unit/deployment/admin-reintegration-monorepo.test.ts
```

Add a focused naming-plan test if package naming becomes machine-checkable in this task.

## Acceptance Criteria

- Package naming decision is documented in this task folder or the PRD is updated.
- Dependency direction is explicit enough for later import-boundary tests.
- The decision does not require external package publishing for V1.

