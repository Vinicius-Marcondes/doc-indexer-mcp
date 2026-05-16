# Package Naming Plan

- `@bun-dev-intel/docs-domain`
- `@bun-dev-intel/db`
- `@bun-dev-intel/contracts`
- `@bun-dev-intel/admin-contracts`
- `@bun-dev-intel/config`
- `@bun-dev-intel/mcp-http`
- `@bun-dev-intel/docs-worker`
- `@bun-dev-intel/admin-console-server`
- `@bun-dev-intel/admin-console-client`

No package is published externally in V1.

Dependency direction:

- `apps/* -> packages/*`
- `packages/* must not import apps/*`
