# Admin Console Reintegration And Monorepo Architecture PRD

The target architecture is a single Bun workspace monorepo with isolated runtime app boundaries and shared packages.

- Do not adopt BHVR as a framework-level dependency.
- Keep migrations at root under `migrations/remote-docs/`.
- Runtime apps live under `apps/mcp-http`, `apps/docs-worker`, `apps/admin-console/server`, and `apps/admin-console/client`.
- Shared implementation lives under `packages/docs-domain`, `packages/db`, `packages/contracts`, and `packages/admin-contracts`.
- Implementation must be test-driven, with import-boundary tests protecting app/package direction and deployment tests protecting Docker behavior.
