# Source Revalidation: Remote Docs Admin Web Interface

Revalidated on 2026-05-14 for Task 00.

## Checked Sources

| Area | Source | Finding |
| --- | --- | --- |
| BHVR structure | `https://bhvr.dev/getting-started` | BHVR documents a Bun + Hono + Vite + React stack with root workspaces and separate `client/`, `server/`, and `shared/` packages. For this repo, use the same separation under `apps/admin-console` and `packages/admin-contracts` without moving existing `src/`. |
| React | `https://react.dev/versions` | React docs list the current major/minor docs line as React 19.2. npm registry reports `react` and `react-dom` latest as `19.2.6`. |
| Vite | `https://vite.dev/guide/` | Vite supports Bun scaffolding with `bun create vite` and direct template selection. npm registry reports `vite` latest as `8.0.13`. |
| Bun | `https://bun.com/` | Bun site advertises Bun `1.3.14`. The local runtime in this worktree is `1.3.11`, so implementation should avoid syntax or CLI behavior that requires a newer Bun unless the repo upgrades its runtime. |
| Hono on Bun | `https://hono.dev/docs/getting-started/bun` | Hono documents Bun setup through `bun create hono@latest`, installing `hono`, and serving static files with `serveStatic` from `hono/bun`. npm registry reports `hono` latest as `4.12.18`, matching the existing repo dependency. |
| npm package metadata | `bun pm view <package> version` | Used to verify exact package versions for the package plan below. |

## Package Plan

Use pinned exact versions for newly added frontend/admin dependencies. Existing root dependencies may stay at their current versions unless the task explicitly changes them.

### Root / Existing Server

| Package | Version | Notes |
| --- | ---: | --- |
| `hono` | `4.12.18` | Already present in root dependencies. Reuse for admin Hono server. |
| `zod` | `4.4.3` | npm latest, but root currently uses `^4.1.13`. For Task 01, reuse root `zod/v4` import style and avoid upgrading root unless needed by contract workspace tests. |
| `typescript` | `5.9.3` | Already present in root dev dependencies. Use for workspaces. |

### Admin Client

| Package | Version | Notes |
| --- | ---: | --- |
| `@vitejs/plugin-react` | `6.0.1` | Vite React plugin for React app build. |
| `@tanstack/react-query` | `5.100.10` | API state and cache invalidation. |
| `lucide-react` | `1.16.0` | Icons for navigation, buttons, and status UI. |
| `react` | `19.2.6` | Latest stable npm package; satisfies React 19 requirement. |
| `react-dom` | `19.2.6` | Match `react`. |
| `react-router` | `7.15.1` | Client routing. |
| `recharts` | `3.8.1` | KPI charts. |
| `vite` | `8.0.13` | Vite build/dev server. |

### Admin Client Test Tooling

| Package | Version | Notes |
| --- | ---: | --- |
| `@playwright/test` | `1.60.0` | Browser smoke tests in later tasks. |
| `@testing-library/jest-dom` | `6.9.1` | DOM assertions when frontend tests are introduced. |
| `@testing-library/react` | `16.3.2` | React component tests. |
| `vitest` | `4.1.6` | Browser-like frontend unit tests if `bun:test` is insufficient for React rendering. |

## Component Strategy

Use custom components plus small focused libraries in V1:

- custom CSS and reusable local components for tables, buttons, forms, dialogs, badges, and shell layout
- `lucide-react` for icons
- `recharts` for charts
- no shadcn/Radix dependency in Task 01

Radix/shadcn-style primitives may be reconsidered later if dialogs, menus, and accessibility concerns become too expensive to maintain manually. They are intentionally deferred from the initial package plan to keep dependency and styling scope controlled.

## Architecture Decision

Use a BHVR-inspired monorepo addition rather than a full repository migration:

```text
apps/admin-console/client
apps/admin-console/server
packages/admin-contracts
src/
```

The existing `src/` MCP server, HTTP entrypoint, docs worker, storage, and retrieval modules remain in place. The admin console becomes an optional service and can be built/deployed separately.

## Risks And Follow-Up

- Local Bun is `1.3.11`, while current Bun is `1.3.14`; avoid depending on new CLI/runtime behavior until the repo intentionally upgrades Bun.
- Vite 8 is current, but this repo currently has no frontend tooling. Task 01 should keep the scaffold minimal and verify root gates before expanding UI features.
- `zod` root dependency is older than npm latest but already v4-compatible. Avoid upgrading it in Task 01 unless the contracts package requires it.
- Adding Playwright may require browser binaries later. Do not install browsers until the browser smoke task needs them.
