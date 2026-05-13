# Task Plan Index: Bun Dev Intelligence MCP Agent Output V2

Source PRD: [docs/prd/bun-dev-intel-mcp-agent-output-v2.md](../prd/bun-dev-intel-mcp-agent-output-v2.md)

This file is intentionally short. Detailed tasks are split into focused cluster files so future agents can read only the context needed for the active work.

## How To Use

1. Read the PRD summary, goals, non-goals, and data contracts.
2. Read the tracker: [bun-dev-intel-mcp-agent-output-v2/tracker.md](bun-dev-intel-mcp-agent-output-v2/tracker.md).
3. Open only the cluster file for the current task.
4. Before implementation, update the tracker current task and append a short start log.
5. After each finished task, update the tracker status and append a short completion log with tests run.

## Task Clusters

- [00 - Agent Contracts And Response Budgets](bun-dev-intel-mcp-agent-output-v2/00-agent-contracts-response-budgets.md)
- [01 - Task-Shaped Tools](bun-dev-intel-mcp-agent-output-v2/01-task-shaped-tools.md)
- [02 - Citations, Finding Cache, And Delta](bun-dev-intel-mcp-agent-output-v2/02-citations-finding-cache-delta.md)
- [03 - Server Registration, Docs, QA, And Handoff](bun-dev-intel-mcp-agent-output-v2/03-server-docs-qa-handoff.md)

## Global Execution Rules

- Implement PRD behavior only. Do not expand scope unless the PRD is updated first.
- Use Bun as runtime, package manager, and test runner.
- Use TypeScript for all source code.
- Keep MCP transport as stdio only.
- Preserve existing V1 tools unless the PRD is explicitly changed.
- New task-shaped tools must default to `responseMode: "brief"`.
- Never read `node_modules`.
- Never execute shell commands from the MCP server.
- Never mutate analyzed projects.
- Never install packages from the MCP server.
- Never use broad web search inside the server.
- Use only official allowlisted sources from the PRD.
- Do not infer change metadata from model memory.
- Write deterministic tests first. Live network tests must be opt-in.
- Treat every finding or action as invalid unless it has local project evidence, official source evidence, npm registry evidence, or an explicit warning that evidence is missing.

## Definition Of Done

- New agent response contracts are implemented and tested.
- `project_health`, `check_before_install`, `check_bun_api_usage`, and `lint_bun_file` are registered.
- Existing V1 tools remain available.
- Citation maps replace repeated source URL arrays in V2 outputs.
- Brief and standard response budgets are enforced.
- Structured actions are approval-gated and never executed by the server.
- Finding-level cache and delta behavior are tested.
- Source-backed change metadata is never guessed.
- `bun test` passes without network access.
- `bun run typecheck` passes.
- `bun run check` passes.
- README documents which tool agents should call for common tasks.
