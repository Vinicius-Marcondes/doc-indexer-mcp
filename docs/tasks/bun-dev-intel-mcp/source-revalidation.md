# Source Revalidation Notes

Checked date: 2026-05-12

## Task 0.1 Findings

Initial source checks found no blocker for Bun, TypeScript, Zod v4-compatible schemas, SQLite cache storage, and the MCP TypeScript SDK v2 alpha split package target. A later package-metadata mismatch for the documented stdio export was found during Task 13.2 and is recorded below.

## MCP TypeScript SDK v2 Alpha

Checked:

- https://ts.sdk.modelcontextprotocol.io/v2/
- https://github.com/modelcontextprotocol/typescript-sdk
- https://github.com/modelcontextprotocol/typescript-sdk/blob/main/packages/server/package.json
- https://github.com/modelcontextprotocol/typescript-sdk/blob/main/packages/server/src/index.ts
- https://github.com/modelcontextprotocol/typescript-sdk/blob/main/packages/server/src/server/stdio.ts
- https://modelcontextprotocol.io/docs/learn/server-concepts
- https://modelcontextprotocol.io/specification/2025-06-18/server/tools
- https://modelcontextprotocol.io/specification/2025-06-18/server/resources

Confirmed:

- The SDK main branch is still documented as v2 in development/pre-alpha, with v1.x still recommended for production use.
- The server package is `@modelcontextprotocol/server`.
- Current server package version in the repository package manifest is `2.0.0-alpha.2`.
- Public imports are `McpServer` from `@modelcontextprotocol/server` and `StdioServerTransport` from `@modelcontextprotocol/server/stdio`.
- The getting-started example constructs `new McpServer({ name, version })`, registers tools with `server.registerTool(...)`, creates `new StdioServerTransport()`, and connects with `server.connect(transport)`.
- Tool results support `structuredContent` plus backwards-compatible text content. Resources use URI-based read-only content and templates.

Implementation blocker found during Task 13.2:

- The installed `@modelcontextprotocol/server@2.0.0-alpha.2` package imports successfully for `McpServer` and `ResourceTemplate`.
- The documented `@modelcontextprotocol/server/stdio` subpath does not resolve from the published npm artifact. The PRD was updated to allow a local stdio transport compatible with the SDK transport shape while keeping stdio as the only V1 transport.

## Bun Docs

Checked:

- https://bun.com/docs/llms.txt
- https://bun.com/docs/llms-full.txt
- https://bun.com/docs/runtime/typescript
- https://bun.com/docs/pm/cli/install
- https://bun.com/docs/pm/cli/add
- https://bun.com/docs/pm/lockfile
- https://bun.com/docs/test
- https://bun.com/docs/pm/workspaces

Confirmed:

- The docs index files are available and should be used for official docs discovery.
- Bun TypeScript docs still recommend `@types/bun`, `types: ["bun"]`, `moduleResolution: "bundler"`, `module: "Preserve"`, `target: "ESNext"`, and `noEmit: true` for Bun projects.
- `bun install` writes `bun.lock` and installs dependencies, dev dependencies, optional dependencies, and peer dependencies by default.
- Bun v1.2 changed the default lockfile format to text `bun.lock`; legacy `bun.lockb` migration guidance remains current.
- `bun add` and `bun add -d` are the documented package add commands for runtime and development dependencies.
- `bun test` remains the documented test runner command and supports TypeScript tests importing from `bun:test`.
- Bun workspaces are declared through `workspaces` in `package.json`; `bun install` installs all workspaces and supports `--filter`.

## TypeScript TSConfig Docs

Checked:

- https://www.typescriptlang.org/tsconfig/moduleResolution.html
- https://www.typescriptlang.org/tsconfig/module.html
- https://www.typescriptlang.org/tsconfig/target.html
- https://www.typescriptlang.org/tsconfig/noEmit.html
- https://www.typescriptlang.org/tsconfig/types.html

Confirmed:

- `moduleResolution: "bundler"` is documented for bundler-style resolution and does not require file extensions on relative imports.
- `module: "preserve"` preserves each import/export statement form and is documented as reflecting capabilities of modern bundlers and the Bun runtime.
- `target: "ESNext"` remains a moving target tied to the installed TypeScript version and should be recommended with that caveat when relevant.
- `noEmit` keeps TypeScript as type checker/editor tooling while another runtime or tool handles execution.
- `types` restricts included global `@types/*` packages, supporting explicit Bun type inclusion.
