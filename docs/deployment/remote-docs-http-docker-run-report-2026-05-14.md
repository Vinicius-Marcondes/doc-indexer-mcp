# Remote Docs HTTP Docker Run Report - 2026-05-14

## Final Status

The remote docs Docker stack starts successfully.

- `postgres-pgvector`: running and healthy.
- `mcp-http-server`: running and healthy on container port `3000`, published as `localhost:3000`.
- `docs-worker`: running as a long-lived Compose service instead of repeatedly restarting after one worker cycle.
- `GET /healthz`: `200 {"ok":true,"status":"ok","service":"bun-dev-intel-mcp-http"}`.
- `GET /readyz`: `200 {"ok":true,"status":"ready"}`.

The health endpoints were verified from inside the running `mcp-http-server` container. A direct host `curl` from the Codex sandbox could not connect to `127.0.0.1:3000`, but Docker's own healthcheck and in-container HTTP checks passed.

## Applied Changes

- Updated the Docker image to install full locked dependencies instead of production-only dependencies.
  - Reason: runtime modules import the TypeScript compiler API through the server module graph.
  - Fixed error: `Cannot find package 'typescript' from '/app/src/analyzers/...`.

- Updated the remote docs migration for `doc_chunks.search_vector`.
  - Reason: Postgres rejected the generated column expression because `to_tsvector(...)` is not immutable.
  - Fixed error: `PostgresError: generation expression is not immutable`.
  - Solution: use a normal `tsvector` column maintained by a trigger.

- Added docs source seeding during worker startup.
  - Reason: scheduled refresh jobs were being inserted before the `bun` source row existed.
  - Fixed error: foreign key violation on `doc_refresh_jobs.source_id`.

- Fixed `allowed_url_patterns` persistence.
  - Reason: the storage layer inserted a JSON string instead of a JSONB array.
  - Fixed error: `doc_sources_allowed_url_patterns_array` check constraint failure.
  - Solution: convert the text array to JSONB with `to_jsonb(...::text[])`.

- Updated Docker Compose worker behavior.
  - Reason: `bun src/docs-worker.ts` intentionally runs one cycle and exits with code 0, but Compose had `restart: unless-stopped`, causing a constant restart loop.
  - Solution: Compose now runs the existing worker entrypoint in a loop with `DOCS_WORKER_POLL_SECONDS`, defaulting to 300 seconds.

## Migration Result

The Docker migration command completed successfully:

```bash
docker compose --env-file .env run --rm mcp-http-server \
  bun -e 'import { createPostgresClient, runRemoteDocsMigrations } from "./src/docs/storage/database.ts"; const sql = createPostgresClient(Bun.env.DATABASE_URL); await runRemoteDocsMigrations(sql); await sql.end?.({ timeout: 1 });'
```

Postgres printed normal idempotency notices such as existing tables, indexes, and the `vector` extension already existing.

## Remaining Operational Issue

One existing refresh job failed during ingestion with:

```json
{"code":"fetch_failed","message":"OpenAI embedding request failed.","details":{"provider":"openai","retryable":true,"status":429}}
```

This is not a Docker, migration, or server-startup failure. It means the docs worker reached the configured embedding provider and received HTTP 429 from the OpenAI-compatible embeddings API. To ingest docs successfully, use a key with available quota/rate limit or configure `OPENAI_BASE_URL` to point at a local OpenAI-compatible embedding server that returns 1536-dimensional vectors.

The failed job does not prevent the MCP HTTP server from starting or readiness checks from passing.

## Validation

- `bun test tests/integration/docs/refresh/docs-worker.test.ts tests/integration/storage/docs-storage.test.ts`: passed, with the Postgres-backed storage test skipped because no `TEST_DATABASE_URL` was set.
- `bun test tests/unit/deployment/docker-config.test.ts`: passed.
- `bun run typecheck`: passed.
- `bun run check`: passed.
  - 424 passed.
  - 17 skipped.
  - 0 failed.

## Final Docker Evidence

Final `docker compose ps` showed:

- `codingcolsultancy-postgres-pgvector-1`: `Up` and `healthy`.
- `codingcolsultancy-mcp-http-server-1`: `Up` and `healthy`.
- `codingcolsultancy-docs-worker-1`: `Up`.

Final logs showed:

- HTTP server: `bun-dev-intel-mcp http listening on 0.0.0.0:3000`.
- Worker: `bun-dev-intel-mcp docs worker processed 0 refresh jobs (0 succeeded, 0 failed)`.
- Postgres: `database system is ready to accept connections`.
