# Task 00: Revalidate admin UI stack and package plan

## Goal

Confirm the current official package and framework assumptions before adding workspace, frontend, backend, or Docker dependencies.

## Why

The PRD intentionally references current versions of React, Vite, Bun, and the BHVR stack shape. These can change, and the implementation should pin an explicit, reproducible package plan before touching the repo layout.

## Scope

- Revalidate official sources for:
  - BHVR workspace structure.
  - React 19 latest stable line.
  - Vite current stable line and Bun scaffolding support.
  - Bun current stable line.
  - Hono compatibility with Bun.
- Decide exact dependency versions or version ranges for:
  - React and React DOM.
  - Vite and React plugin.
  - Hono.
  - Zod.
  - frontend router.
  - API data-fetching library.
  - icons.
  - charts.
  - frontend test tooling.
  - browser test tooling.
- Record the chosen package plan in `docs/tasks/bun-dev-intel-mcp-admin-web-interface/source-revalidation.md`.

## Out Of Scope

- Do not install packages.
- Do not create workspaces.
- Do not edit application code.

## Required Tests

- Documentation-only task. Validate with a shell check that the source revalidation file exists.

## Acceptance Criteria

- Source revalidation file exists.
- The file lists checked URLs, check dates, selected packages, and unresolved risks.
- The package plan explicitly states whether the project will use Radix/shadcn-style primitives or keep custom components in V1.
