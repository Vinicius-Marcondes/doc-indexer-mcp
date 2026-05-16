# Task 14: Update Docker And Compose

## Goal

Update container and Compose configuration to represent the monorepo apps.

## Scope

- Update Dockerfile for MCP HTTP, docs worker, and admin console.
- Update `docker-compose.yml` with Postgres, MCP HTTP, docs worker, and optional admin console.
- Update `.env.example` for admin variables.
- Preserve existing service defaults where practical.

## Out Of Scope

- Do not add new production infrastructure.
- Do not require admin console for MCP-only deployments.
- Do not change database schema.

## Required Tests

```text
bun test tests/unit/deployment/docker-config.test.ts
docker compose config
```

If Docker is unavailable locally, document the skipped runtime smoke check in the tracker.

## Acceptance Criteria

- Compose includes all required services.
- Admin service is optional or clearly documented.
- Dockerfile can build the app roles from one repo context.
- Deployment config tests pass.

