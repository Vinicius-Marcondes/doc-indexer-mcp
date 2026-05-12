# PRD: Bun Dev Intelligence MCP Audit Logging

## 1. Summary

Add opt-in audit logging to the Bun Dev Intelligence MCP Server so developers can verify when Claude or another MCP client actually invokes server tools.

This PRD is documentation only. It should be saved as `docs/prd/bun-dev-intel-mcp-audit-logging.md` and implemented later.

## 2. Motivation

MCP clients can connect to a server without clearly proving that tool calls are happening. Developers need a local, inspectable audit trail for:

- Which MCP tools were called.
- When each call started and ended.
- Whether the call succeeded or failed.
- How long the call took.
- What detail level was recorded.

## 3. Target Users

- Developers configuring this MCP server in Claude Desktop or Claude Code.
- Coding agents debugging MCP tool availability.
- Maintainers verifying tool-call behavior during integration tests.

## 4. Goals

- Add opt-in JSONL file audit logging.
- Support log levels: `NONE`, `INFO`, `DEBUG`, and `TRACE`.
- Keep stdout strictly reserved for MCP protocol messages.
- Ensure logging never fails a tool call.
- Ensure audit logs are never written inside an analyzed project.

## 5. Non-Goals For V1

- Do not add remote logging.
- Do not add log rotation.
- Do not log to stdout.
- Do not add a new MCP tool or resource only for logs.
- Do not mutate analyzed projects.
- Do not record protocol frames beyond tool-call events.

## 6. Product Scope

### Implementation Target

- Runtime: Bun.
- Language: TypeScript.
- Output format: newline-delimited JSON.
- Hook point: MCP tool registration wrapper in `registerBunDevIntelCapabilities`.
- Configuration: environment variables only.

### Source Policy

No external source access is required for this feature.

## 7. MCP Tools

No new MCP tools are added.

All existing MCP tool handlers must be wrapped so audit events can be emitted for:

- `analyze_bun_project`
- `search_bun_docs`
- `get_bun_best_practices`
- `plan_bun_dependency`
- `review_bun_project`

## 8. MCP Resources

No new MCP resources are added.

## 9. Data Contracts

Audit log event format:

```json
{
  "timestamp": "ISO timestamp",
  "event": "tool_call_start | tool_call_end",
  "toolName": "string",
  "level": "INFO | DEBUG | TRACE",
  "status": "ok | error?",
  "durationMs": "number?",
  "input": "unknown?",
  "inputSummary": "object?",
  "result": "unknown?",
  "resultSummary": "object?",
  "error": "object?"
}
```

Log level behavior:

- `NONE`: write no events.
- `INFO`: timestamp, event, tool name, status, duration.
- `DEBUG`: INFO plus input and result summaries.
- `TRACE`: full input, full structured result, and sanitized errors without stack traces.

Configuration:

```text
BUN_DEV_INTEL_MCP_AUDIT_LOG=/absolute/path/to/bun-dev-intel-mcp.jsonl
BUN_DEV_INTEL_MCP_LOG_LEVEL=NONE|INFO|DEBUG|TRACE
```

Defaults:

- Missing log path disables logging.
- Missing log level defaults to `NONE`.
- Invalid log level disables logging.
- Relative log paths are rejected.

## 10. Local Analysis Requirements

If a tool input includes `projectPath`, the logger must resolve both `projectPath` and `BUN_DEV_INTEL_MCP_AUDIT_LOG`.

If the log file path is inside the analyzed project, skip audit logging for that call.

## 11. Cache Requirements

Audit logs must not use or modify the SQLite source cache.

## 12. Security Requirements

- Never write audit logs to stdout.
- Never include stack traces in logged errors.
- Never fail a tool call because audit logging failed.
- Never create audit files inside analyzed projects.
- `TRACE` may contain sensitive local paths or output payloads and must be explicitly enabled.

## 13. TDD Implementation Workflow

- Write failing unit tests for logger configuration and level behavior.
- Write failing integration tests around registered MCP tool handlers.
- Implement the audit logger and wrapper.
- Update README with Claude Desktop config and `tail -f` monitoring example.
- Run `bun run check`.

## 14. Required Test Categories

### Logger Configuration

- Missing path disables logging.
- Missing level defaults to `NONE`.
- Invalid level disables logging.
- Relative path disables logging.

### Log Levels

- `NONE` writes nothing.
- `INFO` writes usage metadata only.
- `DEBUG` writes summaries without full result payloads.
- `TRACE` writes full input and full structured result.

### MCP Tool Registration

- Calling a registered tool emits start and end events.
- Failed tool calls emit `status: "error"` with sanitized error data.

### Safety

- Audit path inside `projectPath` is skipped.
- Audit logging never writes to stdout.
- File write failures do not fail MCP tool calls.

## 15. Acceptance Criteria For Future Implementation

- A developer can configure Claude Desktop with an audit file and log level.
- `tail -f /tmp/bun-dev-intel-mcp.jsonl` shows tool-call events when Claude uses the MCP server.
- With `BUN_DEV_INTEL_MCP_LOG_LEVEL=NONE`, no audit events are written.
- With `INFO`, tool usage can be proven without payload logging.
- With `TRACE`, full diagnostic payloads are available.
- `bun run check` passes.

## 16. Suggested Future Project Shape

Suggested files:

- `src/logging/audit-logger.ts`
- `tests/unit/logging/audit-logger.test.ts`
- `tests/integration/mcp/audit-logging.test.ts`

README should document:

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

## 17. Source Baseline

No source revalidation is required. This is local server instrumentation only.

## 18. Open Questions For Later Review

- Should future versions support log rotation?
- Should future versions expose a local diagnostics resource?
- Should TRACE logging redact known secret-like fields?

## 19. Task Files And Tracker

If tracked as a formal implementation series, add a new task file under `docs/tasks/bun-dev-intel-mcp/` and a tracker entry before implementation begins.
