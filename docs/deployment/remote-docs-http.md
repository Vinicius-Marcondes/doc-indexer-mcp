# Remote Docs HTTP Deployment

This stack runs the remote HTTP docs-only MCP server, a separate docs worker, and Postgres with pgvector. Put TLS and public routing in front of the HTTP container with a reverse proxy such as Caddy, Nginx, or your platform load balancer; the app container serves plain HTTP on the private network.

This repository keeps the remote docs MCP server, docs worker, and optional admin console in one monorepo. Local stdio project analysis lives in the split-out `bun-dev-intel-stdio-mcp` repository. The MCP HTTP runtime remains docs-only; the admin console is a separate optional process.

## Services

- `mcp-http-server`: runs `bun run db:migrate`, then `bun apps/mcp-http/src/index.ts`, and exposes `/healthz`, `/readyz`, and `/mcp`.
- `docs-worker`: runs `bun apps/docs-worker/src/index.ts` and processes scheduled and on-demand refresh jobs outside request handling.
- `admin-console`: optional `--profile admin` service that runs `bun apps/admin-console/server/src/index.ts` and exposes the admin API/UI on port `3100`.
- `postgres-pgvector`: stores pages, chunks, embeddings, refresh jobs, and retrieval telemetry.

Remote MCP tools:

- `search_docs`: hybrid keyword and semantic documentation search.
- `get_doc_page`: stored page and chunk retrieval for allowlisted official docs.
- `search_bun_docs`: Bun compatibility wrapper backed by the same remote docs retrieval path.

## Environment

Copy `.env.example` to `.env` and replace placeholders before deployment.

Required variables:

- `MCP_HTTP_HOST`
- `MCP_HTTP_PORT`
- `MCP_BEARER_TOKEN`
- `ADMIN_HTTP_HOST`
- `ADMIN_HTTP_PORT`
- `ADMIN_AUTH_LOG_LEVEL`
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
- `ADMIN_COOKIE_SECURE`
- `ADMIN_SESSION_TTL_SECONDS`
- `ADMIN_LOGIN_RATE_LIMIT_WINDOW_SECONDS`
- `ADMIN_LOGIN_RATE_LIMIT_MAX_ATTEMPTS`
- `ADMIN_STATIC_ASSETS_DIR`
- `ADMIN_BOOTSTRAP_EMAIL`
- `ADMIN_BOOTSTRAP_PASSWORD`

`MCP_BEARER_TOKEN`, `OPENAI_API_KEY`, `ADMIN_BOOTSTRAP_PASSWORD`, and database passwords must be supplied through environment variables or an env file outside source control. The HTTP service requires bearer auth for `/mcp`; do not expose it without TLS.

Embedding provider configuration:

```text
EMBEDDING_PROVIDER=openai
OPENAI_API_KEY=<secret>
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
OPENAI_BASE_URL=<optional OpenAI-compatible /v1 endpoint>
OPENAI_EMBEDDING_DIMENSIONS=<optional requested vector size>
```

The current pgvector schema stores 1536-dimension vectors. Local embedding models must return 1536-dimensional embeddings unless the schema and vector validation are updated.

## Local Compose

The repository root `docker-compose.yml` starts the HTTP server, worker, and Postgres/pgvector services.

```bash
cp .env.example .env
docker compose --env-file .env up --build
```

Start the optional admin console with:

```bash
docker compose --env-file .env --profile admin up --build
```

The HTTP server listens on `http://localhost:3000` by default. Use `GET /healthz` for liveness and `GET /readyz` for dependency readiness.
The admin console listens on `http://localhost:3100` when the `admin` profile is enabled.

Authenticate MCP clients with:

```text
Authorization: Bearer <MCP_BEARER_TOKEN>
```

Tokens in query strings are rejected. Configure `DOCS_ALLOWED_ORIGINS` when browser-based or hosted MCP clients need origin checks.

## Migrations

The MCP HTTP container runs migrations automatically before binding the server port. To run the same migration command manually:

```bash
docker compose --env-file .env run --rm mcp-http-server bun run db:migrate
```

## Commands

```bash
bun apps/mcp-http/src/index.ts
bun apps/docs-worker/src/index.ts
bun apps/admin-console/server/src/index.ts
```

Use the same image for all runtime commands. Keep the worker separate from the HTTP service so refresh, embedding, and tombstone checks do not block MCP requests. In Compose, the worker waits for the MCP HTTP healthcheck so the startup migration has completed before the first worker cycle. Keep the admin console optional for MCP-only deployments.

## Refresh Behavior

The scheduled refresh path is controlled by `DOCS_REFRESH_INTERVAL` and defaults to weekly (`7d`). In Docker Compose, `DOCS_WORKER_POLL_SECONDS` controls how often the long-running worker service wakes up to run one worker cycle; the default is 300 seconds.

Before claiming queued jobs, the worker marks stale `running` jobs as failed. `DOCS_REFRESH_RUNNING_TIMEOUT_SECONDS` controls the timeout and defaults to 1800 seconds. This recovers jobs left behind by worker crashes or container restarts without requiring direct SQL edits in normal operation.

On-demand refresh can be queued by docs tools when content is missing, stale, or low confidence. These jobs are bounded, deduplicated by source/URL/job type, and processed by `bun apps/docs-worker/src/index.ts`.

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

## Source Policy

V1 indexes only official Bun documentation:

- `https://bun.com/docs/llms.txt`
- `https://bun.com/docs/llms-full.txt`
- pages under `https://bun.com/docs/`

The source pack rejects non-HTTPS URLs, hostname tricks, path traversal, disallowed redirects, and non-Bun domains. Adding another source pack requires a PRD update and allowlist tests.

## Quality Gates

```bash
bun test
bun run typecheck
bun run check
```

`bun run check` runs `bun test && bun run typecheck`. Live source checks remain opt-in and are separate from deterministic default gates.
