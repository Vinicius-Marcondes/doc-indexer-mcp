# Remote Docs HTTP Deployment

This stack runs the docs-only MCP HTTP server, a separate docs worker, and Postgres with pgvector. Put TLS and public routing in front of the HTTP container with a reverse proxy such as Caddy, Nginx, or your platform load balancer; the app container serves plain HTTP on the private network.

## Services

- `mcp-http-server`: runs `bun src/http.ts` and exposes `/healthz`, `/readyz`, and `/mcp`.
- `docs-worker`: runs `bun src/docs-worker.ts` and processes scheduled and on-demand refresh jobs outside request handling.
- `postgres-pgvector`: runs the `pgvector/pgvector` Postgres image and stores pages, chunks, embeddings, refresh jobs, and retrieval telemetry.

## Environment

Copy `.env.remote-docs.example` to `.env.remote-docs` and replace all placeholder values before deployment.

Required variables:

- `MCP_HTTP_HOST`
- `MCP_HTTP_PORT`
- `MCP_BEARER_TOKEN`
- `DATABASE_URL`
- `EMBEDDING_PROVIDER`
- `OPENAI_API_KEY`
- `OPENAI_EMBEDDING_MODEL`
- `DOCS_REFRESH_INTERVAL`

Common optional variables:

- `DOCS_REFRESH_MAX_PAGES_PER_RUN`
- `DOCS_REFRESH_MAX_EMBEDDINGS_PER_RUN`
- `DOCS_REFRESH_MAX_CONCURRENCY`
- `DOCS_SEARCH_DEFAULT_LIMIT`
- `DOCS_SEARCH_MAX_LIMIT`
- `DOCS_ALLOWED_ORIGINS`

`MCP_BEARER_TOKEN`, `OPENAI_API_KEY`, and database passwords must be supplied through environment variables or an env file outside source control. The HTTP service requires bearer auth for `/mcp`; do not expose it without TLS.

## Local Compose

```bash
cp .env.remote-docs.example .env.remote-docs
docker compose -f docker-compose.remote-docs.yml --env-file .env.remote-docs up --build
```

The HTTP server listens on `http://localhost:3000` by default. Use `GET /healthz` for liveness and `GET /readyz` for dependency readiness.

## Migrations

Run migrations before first use and after schema changes. The migration helper is `runRemoteDocsMigrations`.

```bash
docker compose -f docker-compose.remote-docs.yml --env-file .env.remote-docs run --rm mcp-http-server \
  bun -e 'import { createPostgresClient, runRemoteDocsMigrations } from "./src/docs/storage/database.ts"; const sql = createPostgresClient(Bun.env.DATABASE_URL); await runRemoteDocsMigrations(sql); await sql.end?.({ timeout: 1 });'
```

## Commands

```bash
bun src/http.ts
bun src/docs-worker.ts
```

Use the same image for both commands. Keep the worker separate from the HTTP service so refresh, embedding, and tombstone checks do not block MCP requests.
