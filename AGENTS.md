# AGENTS.md

## 1. Overview

`bun-dev-intel-remote-docs-mcp` is a docs-only remote MCP service for source-backed documentation search, retrieval, ingestion, refresh, and storage. Keep local project analysis, stdio transport, and admin-console runtime code out of this repository.

## 2. Folder Structure

- `src/http.ts`: HTTP server startup; parses remote-docs config, wires the Hono app, and starts `Bun.serve`.
- `src/http/`: HTTP boundary code for `/healthz`, `/readyz`, `/mcp`, bearer auth, origin checks, body limits, and Streamable HTTP transport wiring.
- `src/server.ts`: MCP capability registry; registers the docs-only tools/resources, creates dependencies, wraps tool/resource output as JSON MCP content, and audits tool calls.
- `src/tools/`: MCP tool handlers. Each handler validates unknown input, checks source policy, calls retrieval/page stores, and queues refresh work when needed.
- `src/resources/`: MCP resource handlers and output mappers for indexed sources, pages, chunks, and Bun docs compatibility resources.
- `src/docs/`: remote documentation pipeline.
  - `sources/`: source-pack contracts, Bun source policy, discovery, redirect revalidation, and content normalization.
  - `ingestion/`: page chunking and ingestion orchestration from discovery through page/chunk/embedding storage.
  - `embeddings/`: embedding provider contract, fake provider, OpenAI-compatible provider, and dimension validation.
  - `retrieval/`: keyword, vector, and hybrid retrieval, scoring, freshness, confidence, warnings, and telemetry.
  - `refresh/`: refresh queue, scheduled/on-demand worker, stale job recovery, source-level exclusivity, and tombstone policy.
  - `storage/`: Postgres client, migration runner, row mappers, and storage methods for sources, pages, chunks, embeddings, jobs, and telemetry.
- `src/sources/`: compatibility source fetch/cache adapters and the broader official-source allowlist used by legacy Bun docs resources.
- `src/cache/`: SQLite compatibility cache and fallback policy for legacy resource paths.
- `src/config/`: remote docs environment parsing and validation.
- `src/shared/`: Zod-backed response contracts and structured error helpers shared across tools/resources.
- `src/logging/`: audit logging with payload summarization, project-path safety, and error sanitization.
- `migrations/remote-docs/`: Postgres/pgvector schema for docs sources, pages, chunks, embeddings, refresh jobs, and retrieval telemetry.
- `tests/`: unit, integration, e2e, and opt-in live tests; mirror source areas when adding coverage.
- `docs/`: PRDs, task trackers, traceability notes, and deployment documentation that must stay aligned with implementation changes.
- `Dockerfile`, `docker-compose.yml`, `.env.example`: deployment scaffolding for the HTTP server, worker, and Postgres/pgvector stack.

## 3. Core Behaviors & Patterns

- **HTTP boundary and capability partitioning**: `createRemoteHttpApp` owns request-level safety before `/mcp` reaches the MCP transport: query-string tokens are rejected, optional origins are checked, bearer auth is required, and body size is bounded. `src/server.ts` registers only remote docs tools/resources, so new capabilities must not reintroduce stdio transport, local project analyzers, or admin-console code.
- **Dependency injection for testable flows**: Factories accept dependencies such as `now`, `fetchImpl`, `sql`, stores, registries, queues, and providers. Preserve this shape when extending code so tests can exercise HTTP, retrieval, ingestion, refresh, and logging without live network or global time.
- **Structured validation and errors**: Tool/resource inputs start as `unknown`, pass through Zod `safeParse`, and return `{ ok: false, error: StructuredError }` for user-facing failures. Shared helpers in `src/shared/errors.ts` create stable error codes; reserve thrown errors for startup failures, impossible storage invariants, or unexpected worker exceptions that are converted before persistence/logging.
- **Source policy at every boundary**: Source packs and registries are the authority for allowed docs. Discovery, ingestion, tools, resources, and refresh queue paths all call `checkUrl`/registry checks before fetching, storing, or queueing work. Bun V1 accepts only HTTPS `bun.com/docs` index/page URLs and revalidates redirects against the same policy.
- **Ingestion lifecycle**: The pipeline discovers index pages, fetches allowed pages, normalizes content, upserts source/page rows, chunks by Markdown structure, reuses unchanged chunks and existing embeddings, and inserts missing embeddings idempotently. Keep content hashes, canonical URLs, chunk indexes, and embedding metadata consistent across this flow.
- **Retrieval and refresh coupling**: Hybrid retrieval merges keyword and vector candidates, boosts exact technical terms, computes freshness/confidence, records telemetry best-effort, and surfaces warnings. `search_docs` and `get_doc_page` translate missing/stale/low-confidence/manual signals into bounded refresh jobs without blocking the response.
- **Refresh worker resilience**: The queue deduplicates pending work by source/URL/job type, applies global and per-source bounds, and delays jobs after recent failures. The worker recovers stale `running` jobs, avoids running page-level jobs alongside a source-wide job for the same source, marks each job succeeded/failed independently, and tombstones pages only after repeated confirmed 404/410 failures.
- **Logging and audit safety**: Audit logging is opt-in and writes only to absolute paths outside the requested project path. DEBUG logs summarize payloads, TRACE can include full payloads, and worker failure logs redact bearer tokens, API-key-like strings, and raw content/body wording before writing messages.

## 4. Conventions

- **TypeScript shape**: Use strict TypeScript with `readonly` interfaces for public data shapes, discriminated unions for results, `type` imports where appropriate, and camelCase application fields. Database row interfaces stay snake_case and are converted through `map*` helpers.
- **Schema naming**: Zod imports use `zod/v4`; schemas are named with a `Schema` suffix and paired with inferred or explicit TypeScript types. Public tool inputs expose `*InputSchema` constants beside the handler that consumes them.
- **Result naming**: Reusable flows define `Success`, `Failure`, and union result types with `ok: true` / `ok: false`. Keep response fields source-backed: citations, freshness, confidence, warnings, hashes, and refresh metadata should remain present where the contract supports them.
- **Factory and dependency names**: Constructors take `*Options`; pure handlers take `*Dependencies`; startup functions use `start*`/`run*`; config parsers use `parse*`; resource readers use `read*`. Continue injecting `now` instead of calling `new Date()` deep inside logic unless the surrounding module already owns wall-clock behavior.
- **Storage boundaries**: Keep SQL inside `src/docs/storage/` using the tagged `postgres` client and explicit row mappers. Validate vector dimensions before inserting embeddings, keep pgvector assumptions synchronized with config validation, and make idempotent inserts return compatible existing rows.
- **Config boundaries**: Add environment variables through `parseRemoteDocsConfig`, tests, `.env.example`, and deployment docs together. Startup functions should report config issues as structured startup failures rather than leaking partial service state.
- **Comments**: Prefer clear names and small helpers over comments. Use short comments only to explain non-obvious fallback, redaction, migration, or security behavior.
- **Documentation traceability**: When behavior changes a PRD-backed feature, update the relevant `docs/prd/`, `docs/tasks/`, traceability, README, and deployment docs so public guidance matches the code.

## 5. Working Agreements

- Respond in the user's preferred language; if unspecified, infer from the repo, keep technical terms in English, and never translate code blocks.
- Never read inside `node_modules`.
- Before any git command, read the git rules under `docs/`; if no dedicated `docs/git*` file exists, report that gap before push or release work.
- Never run `git push origin master`.
- Ask the user before introducing tests, lint, or formatter setups; add them only on explicit request.
- Build context by reviewing related usages, flows, patterns, and likely impact before editing.
- Fix the underlying cause, not only the visible symptom; inspect affected flows and apply the narrowest complete change that resolves the root issue.
- Check side effects across callers, shared abstractions, and behavior/API boundaries; report relevant impact and compatibility risks.
- Ask actively when user decisions are needed for scope, behavior, or tradeoffs.
- Run type-check after code changes with `bun run typecheck`; for documentation-only changes, explain if type-check was not needed.
- New functions should be single-purpose and colocated with related code.
- Add external dependencies only when necessary and explain why.
