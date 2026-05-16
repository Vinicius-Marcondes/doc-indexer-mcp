# Remote Docs HTTP Package Plan

Runtime dependencies:

- `@modelcontextprotocol/server` for the Streamable HTTP MCP server primitives.
- `hono` for the HTTP shell, health checks, auth middleware, and routing.
- `postgres` for the shared Postgres/pgvector connection.
- `openai` for embedding provider integration.

No product behavior changes are introduced by dependency planning alone. Runtime behavior remains covered by MCP, retrieval, storage, deployment, and boundary tests.
