# Package Plan - Remote Docs HTTP MCP

Task: [01 - Select MCP SDK/Package Plan And Dependency Baseline](01-select-sdk-and-dependency-plan.md)

Checked date: 2026-05-14

## Decision

Keep the current MCP v2 split package line and add only the dependencies needed by later remote-docs tasks.

No product behavior is introduced by this task. There is no Hono app, HTTP server startup, migration runner, docs retrieval service, embedding provider implementation, worker, or Docker configuration in this dependency baseline.

## Runtime Dependencies

| Package | Version | Purpose | First expected use |
| --- | --- | --- | --- |
| `@modelcontextprotocol/server` | `2.0.0-alpha.2` | MCP server package and Web Standard Streamable HTTP transport provider. | Task 04 HTTP transport. |
| `hono` | `^4.12.18` | Thin Bun HTTP framework required by the PRD. | Task 03 HTTP shell. |
| `postgres` | `^3.4.9` | Bun-compatible Postgres client for DB access and future internal migration execution. | Tasks 06-07 migrations/storage. |
| `openai` | `^6.37.0` | Official OpenAI client for the later embedding provider. | Task 12 OpenAI embedding provider. |

Existing dependencies remain:

- `@cfworker/json-schema` for MCP schema compatibility.
- `zod` v4 for contracts and tool input schemas.

## Import Baseline

Selected imports must compile:

```ts
import { McpServer, WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';
import { Hono } from 'hono';
import postgres from 'postgres';
import OpenAI from 'openai';
```

Historical MCP stdio package mismatch:

- The installed `@modelcontextprotocol/server@2.0.0-alpha.2` package still does not resolve `@modelcontextprotocol/server/stdio` in this workspace.
- The stdio shim is now owned by the split-out `bun-dev-intel-stdio-mcp` repository; this repository no longer exposes stdio.

## Package Boundaries

- Remote HTTP transport packages stay isolated from docs retrieval, ingestion, embeddings, and storage modules.
- Local stdio and local project-analysis behavior are owned by the split-out stdio project.
- `postgres` is the DB access baseline; later migration tasks should implement a small repository-local SQL migration runner before adding another migration dependency.
- `openai` is installed now so Task 12 can focus on provider behavior and mocked tests rather than package selection.
- No `start` script is added yet because the HTTP entrypoint does not exist until later tasks.

## Deferred Decisions

- Task 04 should choose between direct `WebStandardStreamableHTTPServerTransport` wiring and `@modelcontextprotocol/hono` helper wiring based on tests.
- Task 06 should decide the exact migration file layout and whether any extra migration helper is justified.
- Task 12 should configure the embedding model through runtime config; the current default remains `text-embedding-3-small`.
