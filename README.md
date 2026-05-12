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
- It skips `node_modules`, build output, binary files, and secret-like files during project analysis.
- It uses stdio transport only. The project includes a local stdio transport because the published `@modelcontextprotocol/server@2.0.0-alpha.2` package does not expose the documented `@modelcontextprotocol/server/stdio` subpath.
- Audit logging is off by default, writes only to the configured file, never writes to stdout, and skips writes when the audit path is inside the analyzed project.

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

The cache stores fetched official Bun docs and npm metadata. Project analysis resources are in-memory for the current server process and are marked stale when source file hashes change.

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
