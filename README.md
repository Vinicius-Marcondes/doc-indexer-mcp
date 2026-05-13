# Bun Dev Intelligence MCP Server

Source-backed MCP server for Bun project intelligence. It analyzes local Bun/TypeScript projects, searches official Bun docs, plans Bun dependency commands, and exposes read-only MCP resources.

## Run

Use Bun as the runtime:

```bash
bun src/stdio.ts
```

Example MCP client configuration:

```json
{
  "mcpServers": {
    "bun-dev-intel": {
      "command": "bun",
      "args": ["/Users/vinicius/Projects/Coding Colsultancy/src/stdio.ts"]
    }
  }
}
```

Claude Desktop with tool-call audit logging:

```json
{
  "mcpServers": {
    "bun-dev-intel": {
      "command": "/Users/vinicius/.local/share/mise/installs/bun/1.3.11/bin/bun",
      "args": ["/Users/vinicius/Projects/Coding Colsultancy/src/stdio.ts"],
      "env": {
        "BUN_DEV_INTEL_MCP_AUDIT_LOG": "/tmp/bun-dev-intel-mcp.jsonl",
        "BUN_DEV_INTEL_MCP_LOG_LEVEL": "INFO"
      }
    }
  }
}
```

Monitor tool calls:

```bash
tail -f /tmp/bun-dev-intel-mcp.jsonl
```

## Safety

- The server is read-only for analyzed projects.
- It does not execute shell commands from tool handlers.
- It does not install dependencies or mutate lockfiles.
- V2 `actions` are structured recommendations only. Any command or edit action is approval-gated with `requiresApproval: true`.
- It skips `node_modules`, build output, binary files, and secret-like files during project analysis.
- It uses stdio transport only. The project includes a local stdio transport because the published `@modelcontextprotocol/server@2.0.0-alpha.2` package does not expose the documented `@modelcontextprotocol/server/stdio` subpath.
- Audit logging is off by default, writes only to the configured file, never writes to stdout, and skips writes when the audit path is inside the analyzed project.

## Which Tool Should An Agent Call?

Prefer the V2 task-shaped tools for normal coding workflows:

| Agent task | Tool | Default output |
| --- | --- | --- |
| Quick project scan before editing | `project_health` | Brief V2 envelope with ranked findings, actions, citations, and a `deltaToken`. |
| Check a package before editing dependencies | `check_before_install` | Brief npm-backed findings and an approval-gated Bun install command action. |
| Check whether a Bun API or pattern is current | `check_bun_api_usage` | Brief docs-backed answer with at most one cited example. |
| Check one file before editing | `lint_bun_file` | Brief file-scoped Bun findings with locations when available. |
| Full raw project dump for diagnostics | `analyze_bun_project` | Compatibility/full analysis surface; use only when raw facts are needed. |
| Legacy project review | `review_bun_project` | Legacy shape by default; pass `responseMode` to opt into the V2 envelope. |
| Legacy dependency planner | `plan_bun_dependency` | Legacy shape by default; pass `responseMode` to include structured actions. |

Response modes:

- `brief`: compact default for V2 tools, summary <= 500 characters, limited findings/actions.
- `standard`: more context, summary <= 1200 characters, still citation-compacted.
- `full`: opt-in detail for the requested tool. Full raw project analysis remains under `analyze_bun_project`.

V2 outputs use a top-level `citations` map. Findings, actions, examples, and warnings reference citation IDs instead of repeating full source URLs. Local project evidence is represented as safe `local-project:*` citations and never includes secret file contents.

Migration note: agents that previously called `review_bun_project` for every planning step should call `project_health` first. Use `review_bun_project` only for compatibility with existing clients, or pass `responseMode: "brief"` to receive the V2 envelope while keeping the old tool name.

## Audit Logging

Tool-call audit logging is controlled by environment variables:

```text
BUN_DEV_INTEL_MCP_AUDIT_LOG=/absolute/path/to/bun-dev-intel-mcp.jsonl
BUN_DEV_INTEL_MCP_LOG_LEVEL=NONE|INFO|DEBUG|TRACE
```

Log levels:

- `NONE`: no audit events. This is the default when the level is missing.
- `INFO`: tool call start/end metadata, status, and duration.
- `DEBUG`: `INFO` plus input and result summaries.
- `TRACE`: full tool input, full structured result, and sanitized errors without stack traces.

## Cache

Default cache file:

```text
~/.cache/bun-dev-intel-mcp/cache.sqlite
```

The cache stores fetched official Bun docs, npm metadata, and V2 normalized finding snapshots. Project analysis resources are in-memory for the current server process and are marked stale when source file hashes change. The V2 findings resource is exposed at `bun-project://findings/{projectHash}` after a V2 project-health run has populated findings for that project.

## Sources

Default tests are offline and deterministic. Live source checks are opt-in:

```bash
LIVE_DOCS=1 bun test tests/live
```

Live tests only hit official Bun docs and the npm registry.

## Quality

Required local gates:

```bash
bun test
bun run typecheck
bun run check
```

`bun run check` runs `bun test && bun run typecheck`.
