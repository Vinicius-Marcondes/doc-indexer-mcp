# Remote Docs HTTP Deployment

This stack runs the docs-only MCP HTTP server, a separate docs worker, and Postgres with pgvector. Put TLS and public routing in front of the HTTP container with a reverse proxy such as Caddy, Nginx, or your platform load balancer; the app container serves plain HTTP on the private network.

The remote HTTP mode is intentionally docs-only. Keep local stdio for local project analysis and filesystem-aware tools; use remote HTTP for shared documentation intelligence. The remote server exposes `/mcp` over Streamable HTTP and must not receive `projectPath` inputs or inspect local project files.

## Services

- `mcp-http-server`: runs `bun src/http.ts` and exposes `/healthz`, `/readyz`, and `/mcp`.
- `docs-worker`: runs `bun src/docs-worker.ts` and processes scheduled and on-demand refresh jobs outside request handling.
- `admin-console`: optional profile service that runs `bun apps/admin-console/server/src/index.ts`, serves the built React admin app, and exposes same-origin `/api/admin/*` routes.
- `postgres-pgvector`: runs the `pgvector/pgvector` Postgres image and stores pages, chunks, embeddings, refresh jobs, and retrieval telemetry.

Remote MCP tools:

- `search_docs`: hybrid keyword and semantic documentation search.
- `get_doc_page`: stored page and chunk retrieval for allowlisted official docs.
- `search_bun_docs`: compatibility wrapper backed by the same remote docs retrieval path.

Local stdio remains the surface for `project_health`, `analyze_bun_project`, `review_bun_project`, dependency planning, and any tool that reads a developer's project directory.

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

- `DOCS_WORKER_POLL_SECONDS`
- `DOCS_REFRESH_RUNNING_TIMEOUT_SECONDS`
- `DOCS_REFRESH_MAX_PAGES_PER_RUN`
- `DOCS_REFRESH_MAX_EMBEDDINGS_PER_RUN`
- `DOCS_REFRESH_MAX_CONCURRENCY`
- `DOCS_SEARCH_DEFAULT_LIMIT`
- `DOCS_SEARCH_MAX_LIMIT`
- `DOCS_ALLOWED_ORIGINS`
- `OPENAI_BASE_URL`
- `OPENAI_EMBEDDING_DIMENSIONS`

`MCP_BEARER_TOKEN`, `OPENAI_API_KEY`, and database passwords must be supplied through environment variables or an env file outside source control. The HTTP service requires bearer auth for `/mcp`; do not expose it without TLS.

Optional admin console variables:

- `ADMIN_HTTP_HOST`
- `ADMIN_HTTP_PORT`
- `ADMIN_SESSION_SECRET`
- `ADMIN_COOKIE_SECURE`
- `ADMIN_BOOTSTRAP_EMAIL`
- `ADMIN_BOOTSTRAP_PASSWORD`
- `ADMIN_SESSION_TTL_SECONDS`
- `ADMIN_LOGIN_RATE_LIMIT_WINDOW_SECONDS`
- `ADMIN_LOGIN_RATE_LIMIT_MAX_ATTEMPTS`

`ADMIN_SESSION_SECRET` and `ADMIN_BOOTSTRAP_PASSWORD` must be replaced before the admin profile is started. Keep `ADMIN_COOKIE_SECURE=true` behind HTTPS in deployed environments. The admin console does not use or receive `MCP_BEARER_TOKEN`; it uses email/password sessions stored in Postgres.

Embedding provider configuration:

- `EMBEDDING_PROVIDER=openai`
- `OPENAI_API_KEY=<secret>`
- `OPENAI_EMBEDDING_MODEL=text-embedding-3-small`
- `OPENAI_BASE_URL=<optional OpenAI-compatible /v1 endpoint>`
- `OPENAI_EMBEDDING_DIMENSIONS=<optional requested vector size>`

The OpenAI key is used by the docs worker for chunk embeddings and by semantic retrieval for query embeddings. Provider errors are returned as structured warnings or failed jobs; they should not crash the HTTP server.

For a local OpenAI-compatible embedding server, keep `EMBEDDING_PROVIDER=openai`, set `OPENAI_BASE_URL` to the local `/v1` endpoint, and use a placeholder API key if the local server does not require one:

```text
OPENAI_BASE_URL=http://host.docker.internal:11434/v1
OPENAI_API_KEY=local-placeholder-key
OPENAI_EMBEDDING_MODEL=qwen3-embedding
OPENAI_EMBEDDING_DIMENSIONS=1536
```

The current pgvector schema stores 1536-dimension vectors. Local embedding models must return 1536-dimensional embeddings unless the schema and vector validation are updated. If the local OpenAI-compatible provider supports a `dimensions` request field, set `OPENAI_EMBEDDING_DIMENSIONS=1536`.

## Local Compose

```bash
cp .env.remote-docs.example .env.remote-docs
docker compose -f docker-compose.remote-docs.yml --env-file .env.remote-docs up --build
```

The HTTP server listens on `http://localhost:3000` by default. Use `GET /healthz` for liveness and `GET /readyz` for dependency readiness.

Start the optional admin console only when a human operator needs the UI:

```bash
docker compose -f docker-compose.remote-docs.yml --env-file .env.remote-docs --profile admin up --build
```

The admin console listens on `http://localhost:3100` by default and should be placed behind the same TLS-capable reverse proxy pattern as the MCP HTTP service. Omit `--profile admin` to run only Postgres, MCP HTTP, and the docs worker.

Authenticate MCP clients with:

```text
Authorization: Bearer <MCP_BEARER_TOKEN>
```

Tokens in query strings are rejected. Configure `DOCS_ALLOWED_ORIGINS` when browser-based or hosted MCP clients need origin checks.

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
bun apps/admin-console/server/src/index.ts
```

Use the same base image for all service commands. Keep the worker separate from the HTTP service so refresh, embedding, and tombstone checks do not block MCP requests.

For local admin UI development, run the API server and Vite client separately:

```bash
bun run admin:server:dev
bun run admin:client:dev
```

The Vite client proxies `/api/admin/*` to `http://127.0.0.1:3100`. Container builds use the `admin-console` Docker target, run `bun run admin:client:build`, and serve `apps/admin-console/client/dist` from the Hono server.

## Refresh Behavior

The scheduled refresh path is controlled by `DOCS_REFRESH_INTERVAL` and defaults to weekly (`7d`). In Docker Compose, `DOCS_WORKER_POLL_SECONDS` controls how often the long-running worker service wakes up to run one worker cycle; the default is 300 seconds. The docs worker discovers the official Bun docs index, refreshes pages, chunks changed content, writes embeddings, and records failures without blocking MCP requests.

Before claiming queued jobs, the worker marks stale `running` jobs as failed. `DOCS_REFRESH_RUNNING_TIMEOUT_SECONDS` controls the timeout and defaults to 1800 seconds. This recovers jobs left behind by worker crashes or container restarts without requiring direct SQL edits in normal operation.

On-demand refresh can be queued by docs tools when content is missing, stale, or low confidence. These jobs are bounded, deduplicated by source/URL/job type, and processed by `bun src/docs-worker.ts`. Search returns the best available cited evidence promptly and reports `refreshQueued`.

## Monitoring

The worker writes one safe line for each failed job with the job id, source id, job type, status, structured error code, and sanitized message. Recovery passes log how many stale `running` jobs were marked failed. The worker container can be `Up` while sleeping between cycles; use logs and database counts to confirm recent activity.

Job status counts:

```sql
select status, count(*)::int
from doc_refresh_jobs
group by status
order by status;
```

Stale running jobs:

```sql
select id, source_id, job_type, attempt_count, started_at, updated_at
from doc_refresh_jobs
where status = 'running'
  and coalesce(started_at, updated_at) < now() - make_interval(secs => 1800)
order by coalesce(started_at, updated_at);
```

Content and embedding counts:

```sql
select
  (select count(*)::int from doc_pages where tombstoned_at is null) as doc_pages,
  (select count(*)::int from doc_chunks) as doc_chunks,
  (select count(*)::int from doc_embeddings) as doc_embeddings;
```

Missing embeddings:

```sql
select count(*)::int as chunks_without_embeddings
from doc_chunks c
left join doc_embeddings e on e.chunk_id = c.id
where e.id is null;
```

Embedding model/version:

```sql
select provider, model, embedding_version, dimensions, count(*)::int
from doc_embeddings
group by provider, model, embedding_version, dimensions
order by provider, model, embedding_version;
```

`DOCS_REFRESH_RUNNING_TIMEOUT_SECONDS` should match the stale running query threshold. The default is 1800 seconds.

## Source Policy

V1 indexes only official Bun documentation:

- `https://bun.com/docs/llms.txt`
- `https://bun.com/docs/llms-full.txt`
- pages under `https://bun.com/docs/`

The source pack rejects non-HTTPS URLs, hostname tricks, path traversal, disallowed redirects, and non-Bun domains. Adding another source pack requires a PRD update and allowlist tests.

## Quality Gates

Run these before changing deployment configuration or cutting a release:

```bash
bun test
bun run typecheck
bun run check
```

`bun run check` runs `bun test && bun run typecheck`. Live source checks remain opt-in and are separate from the deterministic default gates.
