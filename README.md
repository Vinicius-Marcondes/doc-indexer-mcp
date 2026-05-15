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

## Remote Docs HTTP

The project also includes a remote docs-only MCP server over Streamable HTTP for shared documentation search. It runs separately from local stdio:

- local stdio: local project analysis and filesystem-aware tools.
- remote HTTP: docs-only tools at `/mcp` with bearer-token auth.

Run the HTTP server and worker:

```bash
bun src/http.ts
bun src/docs-worker.ts
```

For local Docker, start the HTTP server, worker, and Postgres stack:

```bash
cp .env.remote-docs.example .env.remote-docs
docker compose -f docker-compose.remote-docs.yml --env-file .env.remote-docs up --build
```

Start the optional admin web interface only when an operator needs the browser UI:

```bash
docker compose -f docker-compose.remote-docs.yml --env-file .env.remote-docs --profile admin up --build
```

The admin console is a separate Hono service at `http://localhost:3100` by default. It serves the built React 19/Vite app and same-origin `/api/admin/*` routes, uses email/password sessions with `admin` and `viewer` roles, and connects directly to the remote docs Postgres database. The MCP HTTP bearer token is only for `/mcp`, not for the admin browser session.

### Connect An AI Agent Over HTTP

Configure the agent's MCP client to use Streamable HTTP at the `/mcp` endpoint. The exact config keys vary by agent runtime, but the connection details are:

```text
Transport: Streamable HTTP
URL: https://your-host.example.com/mcp
Authorization: Bearer <MCP_BEARER_TOKEN>
```

Local development URL:

```text
http://localhost:3000/mcp
```

Generic MCP client configuration shape:

```json
{
  "mcpServers": {
    "bun-dev-intel-docs": {
      "transport": "http",
      "url": "https://your-host.example.com/mcp",
      "headers": {
        "Authorization": "Bearer ${MCP_BEARER_TOKEN}"
      }
    }
  }
}
```

If your agent separates transport type from URL, select `streamable-http` or `http` transport and use the same `/mcp` URL. MCP clients normally set protocol headers for you; raw HTTP callers must send `Accept: application/json, text/event-stream` and `Content-Type: application/json` for JSON-RPC POST requests.

Example raw initialize request:

```bash
curl -sS https://your-host.example.com/mcp \
  -H "Authorization: Bearer $MCP_BEARER_TOKEN" \
  -H "Accept: application/json, text/event-stream" \
  -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"example-agent","version":"0.0.0"}}}'
```

Do not configure remote agents with the local stdio command unless they need local project analysis. The HTTP server is docs-only and exposes `search_docs`, `get_doc_page`, and `search_bun_docs`.

### Configure Embeddings

The remote docs service uses embeddings for semantic and hybrid search. The default production setup is OpenAI:

```text
EMBEDDING_PROVIDER=openai
OPENAI_API_KEY=<openai-api-key>
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
```

To use a local OpenAI-compatible embedding server, keep `EMBEDDING_PROVIDER=openai` and point the OpenAI client at the local `/v1` endpoint:

```text
EMBEDDING_PROVIDER=openai
OPENAI_BASE_URL=http://localhost:11434/v1
OPENAI_API_KEY=local-placeholder-key
OPENAI_EMBEDDING_MODEL=qwen3-embedding
OPENAI_EMBEDDING_DIMENSIONS=1536
```

When running through Docker Compose on macOS, use the host gateway name instead of `localhost`:

```text
OPENAI_BASE_URL=http://host.docker.internal:11434/v1
```

The local server must expose an OpenAI-compatible `POST /v1/embeddings` API. The current pgvector schema stores 1536-dimension vectors, so use a local embedding model or endpoint configuration that returns 1536-dimensional embeddings. For models that support configurable output size, keep `OPENAI_EMBEDDING_DIMENSIONS=1536`.

Docker, compose, auth, refresh, embedding provider, and source-policy details are in [docs/deployment/remote-docs-http.md](docs/deployment/remote-docs-http.md).

## Safety

- The server is read-only for analyzed projects.
- It does not execute shell commands from tool handlers.
- It does not install dependencies or mutate lockfiles.
- V2 `actions` are structured recommendations only. Any command or edit action is approval-gated with `requiresApproval: true`.
- It skips `node_modules`, build output, binary files, and secret-like files during project analysis.
- Local project-analysis tools use stdio transport. Remote docs tools use Streamable HTTP at `/mcp` and remain docs-only.
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
