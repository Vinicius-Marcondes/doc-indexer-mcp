# Task Plan Index: Bun Dev Intelligence MCP Server

Source PRD: [docs/prd/bun-dev-intel-mcp.md](../prd/bun-dev-intel-mcp.md)

This file is intentionally short. Detailed tasks are split into focused cluster files so future agents can read only the context needed for the active work.

## How To Use

1. Read the PRD summary and constraints.
2. Read the tracker: [bun-dev-intel-mcp/tracker.md](bun-dev-intel-mcp/tracker.md).
3. Open only the cluster file for the current task.
4. Before implementation, update the tracker current task and append a short start log.
5. After each finished task, update the tracker status and append a short completion log with tests run.

## Task Clusters

- [00 - Baseline, Scaffold, And Fixtures](bun-dev-intel-mcp/00-baseline-scaffold-fixtures.md)
- [01 - Contracts, Security, And Cache](bun-dev-intel-mcp/01-contracts-security-cache.md)
- [02 - Official Source Adapters](bun-dev-intel-mcp/02-official-source-adapters.md)
- [03 - Project Analysis And AST](bun-dev-intel-mcp/03-project-analysis-ast.md)
- [04 - Recommendations And MCP Tools](bun-dev-intel-mcp/04-recommendations-tools.md)
- [05 - Resources, Server, QA, And Handoff](bun-dev-intel-mcp/05-resources-server-qa-handoff.md)

## Global Execution Rules

- Implement PRD behavior only. Do not expand scope unless the PRD is updated first.
- Use Bun as runtime, package manager, and test runner.
- Use TypeScript for all source code.
- Target MCP TypeScript SDK v2 alpha with `@modelcontextprotocol/server`.
- Expose stdio transport only.
- Never read `node_modules`.
- Never execute shell commands from the MCP server.
- Never mutate analyzed projects.
- Never use broad web search inside the server.
- Use only official allowlisted sources from the PRD.
- Write deterministic tests first. Live network tests must be opt-in.
- Treat every recommendation as invalid unless it has local project evidence, official source evidence, npm registry evidence, or an explicit warning that evidence is missing.

## Definition Of Done

- All required MCP tools and resources are registered.
- `bun test` passes without network access.
- `tsc --noEmit` passes.
- Source allowlisting is enforced.
- Cache metadata is present in docs and registry responses.
- Project analysis skips `node_modules`, generated output, and secret files.
- No server code path executes local shell commands.
- Every recommendation includes citation or local evidence.
- A local MCP client can start the server over stdio.
