# Package Naming Plan

## Decision

Use the existing internal `@bun-dev-intel/*` namespace for all workspace packages and app packages.

Rationale:

- The current root package already uses the Bun Dev Intel product name.
- The split admin console already uses `@bun-dev-intel/admin-contracts`.
- Keeping the namespace avoids unnecessary import churn while reintegrating the admin source.
- The packages are private implementation boundaries, not published public SDKs.

No package is published externally in V1. Workspace packages are versioned by repository commits and the root lockfile.

## App Package Names

| App | Package name | Purpose |
| --- | --- | --- |
| `apps/mcp-http` | `@bun-dev-intel/mcp-http` | MCP Streamable HTTP runtime boundary |
| `apps/docs-worker` | `@bun-dev-intel/docs-worker` | Scheduled and on-demand docs refresh worker |
| `apps/admin-console/server` | `@bun-dev-intel/admin-console-server` | Admin API and static admin asset host |
| `apps/admin-console/client` | `@bun-dev-intel/admin-console-client` | React/Vite admin browser application |

## Internal Package Names

| Package | Package name | Purpose |
| --- | --- | --- |
| `packages/docs-domain` | `@bun-dev-intel/docs-domain` | Source policy, ingestion, embeddings, retrieval, refresh, and transport-neutral docs services |
| `packages/db` | `@bun-dev-intel/db` | Postgres client, migration runner, storage adapters, row mappers, and DB test harness |
| `packages/contracts` | `@bun-dev-intel/contracts` | Shared docs/MCP-adjacent DTOs, Zod schemas, and structured errors |
| `packages/admin-contracts` | `@bun-dev-intel/admin-contracts` | Browser-safe admin API DTOs and Zod schemas |
| `packages/config` | `@bun-dev-intel/config` | Shared runtime config parsing helpers and app config parsers |

## Dependency Direction

Allowed:

```text
apps/* -> packages/*
packages/docs-domain -> packages/contracts
packages/docs-domain -> storage interfaces from packages/db only when needed
packages/db -> packages/contracts
packages/config -> packages/contracts only when config schemas need shared enums
packages/admin-contracts -> external browser-safe dependencies only
```

Disallowed:

```text
packages/* must not import apps/*
apps/mcp-http must not import apps/admin-console/*
apps/admin-console/server must not import apps/mcp-http/*
apps/admin-console/client must not import packages/db
apps/admin-console/client must not import server-only packages/docs-domain exports
packages/contracts must not import packages/db
packages/admin-contracts must not import packages/db
packages/admin-contracts must not import apps/*
```

## Compatibility Notes

- Existing root `src/*` imports may remain temporarily during extraction phases.
- Temporary compatibility re-exports must be documented in the tracker and removed or explicitly carried into final cleanup.
- The admin server may temporarily import existing target-repo `src/docs/*` modules during the import phase to avoid copying the split repo's duplicated docs-domain source.
- The final target is app-to-package imports only for shared behavior.

## Testing Implications

Import-boundary tests should eventually verify:

- Packages do not import apps.
- Admin client imports only browser-safe packages.
- MCP HTTP imports no admin server or client modules.
- Admin server imports shared packages, not root `src/docs` compatibility paths, after package extraction.
- No duplicate docs-domain implementation exists under admin app paths.

