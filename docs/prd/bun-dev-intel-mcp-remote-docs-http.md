# PRD: Remote Docs Intelligence MCP Over Streamable HTTP

## 1. Summary

Add a remote, Docker-deployable MCP server mode that exposes source-backed documentation search over modern Streamable HTTP. The first supported documentation source is official Bun documentation. The design must be generic enough to add additional documentation domains later, such as TypeScript, MCP, SAP Commerce, framework docs, and internal engineering docs.

The remote server will provide docs-only MCP tools backed by a Postgres database with `pgvector`. It will use hybrid retrieval: exact keyword/full-text search plus semantic vector search, merged into compact, cited results for coding agents. It will support both scheduled refresh and bounded on-demand refresh through a separate docs worker.

This PRD is documentation only. It does not implement HTTP transport, database schema, vector search, crawling, Docker files, task files, or tests. Implementation must happen later after this PRD is reviewed.

## 2. Motivation

The current `search_bun_docs` implementation searches parsed sections from `https://bun.com/docs/llms-full.txt` with simple lexical scoring. That works for deterministic V1 evidence, but it produces weak results for natural-language questions, narrow API references, and agent workflows that need ranked, reusable documentation context.

Remote agents also need a shared MCP endpoint they can access over HTTP. Running the current stdio server on each agent machine does not solve shared docs retrieval, centralized indexing, or controlled refresh behavior. At the same time, remote HTTP cannot safely or directly inspect local project paths on agent machines.

The goal is to separate concerns:

- Keep local project analysis local, through the existing stdio/local server path.
- Add a remote docs intelligence service for shared documentation search and retrieval.
- Store normalized docs, chunks, metadata, and embeddings in Postgres so retrieval is fast, auditable, and reusable.
- Use official source allowlists and freshness metadata so agents can cite current evidence instead of relying on model memory.

## 3. Target Users

- Remote coding agents that need current Bun documentation over MCP.
- Agent runtimes that connect to MCP servers through Streamable HTTP.
- Developers deploying a shared docs intelligence server on a VPS or container runtime.
- Future maintainers adding new documentation domains without rewriting the retrieval system.

## 4. Goals

- Add a modern Streamable HTTP MCP entrypoint for remote docs tools.
- Keep the existing stdio entrypoint and local project-analysis behavior intact.
- Require bearer-token authentication for every HTTP MCP request.
- Provide docs-only tools over HTTP for search and page retrieval.
- Support Bun docs first while preserving a source-pack architecture for future domains.
- Store documentation pages, chunks, embeddings, freshness metadata, and retrieval telemetry in Postgres.
- Use `pgvector` for semantic retrieval and Postgres full-text search for exact retrieval.
- Return compact, cited, source-backed results with freshness and retrieval metadata.
- Support scheduled refresh with configurable frequency, defaulting to weekly.
- Support bounded on-demand refresh when content is missing, stale, or low-confidence.
- Keep ingestion work outside the request path by using a docs worker.
- Make implementation test-driven, incremental, and compatible with the existing project structure.
- Keep every implementation task small enough for a focused commit with a descriptive message.

## 5. Non-Goals For V1

- Do not remove or replace the existing stdio server.
- Do not expose local project filesystem analysis over the remote HTTP server.
- Do not accept arbitrary `projectPath` values in the remote docs-only server.
- Do not perform broad open-web search.
- Do not crawl non-allowlisted domains.
- Do not use blogs, forums, Stack Overflow, social media, or search-engine result pages as recommendation sources.
- Do not execute shell commands from inside MCP tool handlers.
- Do not mutate analyzed projects.
- Do not add deprecated HTTP+SSE transport.
- Do not implement full OAuth in V1.
- Do not implement multi-tenant user management in V1.
- Do not use Obsidian as the production retrieval store.
- Do not make an AI agent responsible for baseline crawling correctness in V1.

## 6. Product Scope

### Implementation Target

- Language: TypeScript.
- Runtime and package manager: Bun.
- Existing local transport: keep stdio.
- New remote transport: MCP Streamable HTTP only.
- HTTP framework: Hono on Bun.
- HTTP endpoint path: `/mcp`.
- Authentication: single shared bearer token.
- Deployment: Docker-compatible application image plus Postgres with `pgvector`.
- Database: Postgres with full-text search and `pgvector`.
- Default embedding provider: OpenAI.
- Embedding provider design: replaceable provider abstraction.
- Test runner: `bun:test`.
- Schema validation: Zod v4-compatible schemas.

The current codebase uses `@modelcontextprotocol/server@2.0.0-alpha.2`, and previous implementation found that the documented stdio subpath was not exposed by the installed package. Before implementation starts, the MCP SDK package plan must be revalidated. If the modern Streamable HTTP transport requires moving to `@modelcontextprotocol/sdk` or a newer package layout, that upgrade must be planned explicitly and covered by tests.

### HTTP Application Framework

The remote HTTP server must use Hono as the application framework on Bun.

Hono is selected because:

- It is compatible with Bun and Web Standards request/response APIs.
- It gives the HTTP layer a small, typed routing and middleware surface.
- It provides useful middleware patterns for bearer authentication, body limits, CORS/origin handling, secure headers, request IDs, and structured error responses.
- It avoids hand-rolling security-sensitive HTTP plumbing directly on `Bun.serve`.
- It is a better fit for a Bun-first service than Express unless SDK compatibility requires an Express fallback.

The HTTP app must remain thin. It should own only:

- Process startup and shutdown.
- Health and readiness routes.
- Bearer-token authentication.
- Origin and host validation.
- Request body limits.
- Secure/default headers.
- Routing `/mcp` to the MCP Streamable HTTP transport.
- Structured HTTP errors for requests rejected before they reach MCP transport.

The HTTP app must not contain docs retrieval, ingestion, embedding, or ranking business logic. Those behaviors must live in docs services that can be tested without starting an HTTP server.

Expected HTTP routes:

```text
GET /healthz
GET /readyz
POST /mcp
GET /mcp
DELETE /mcp
```

Route requirements:

- `GET /healthz` returns process liveness without touching Postgres or embedding providers.
- `GET /readyz` validates required runtime dependencies such as database connectivity and configured source packs.
- `POST /mcp`, `GET /mcp`, and `DELETE /mcp` are reserved for MCP Streamable HTTP behavior.
- Deprecated HTTP+SSE routes must not be added.

The implementation should prefer official MCP Hono middleware or official Web Standards-compatible Streamable HTTP integration when available. If the SDK package revalidation shows Hono middleware is unavailable or incompatible, the fallback decision must be documented before implementation:

1. Prefer official Web Standards/Bun-compatible MCP transport.
2. Otherwise use the official Node/Express transport only as a documented compatibility fallback.
3. Avoid custom MCP transport implementation unless official packages cannot satisfy the protocol requirements.

Raw `Bun.serve` may be used as the underlying Bun server host for the Hono app, but it should not replace Hono as the application framework unless this PRD is updated.

### Source-Pack Architecture

The docs system must not hard-code Bun concepts throughout the storage and retrieval layers. Bun is the first source pack, not the only source pack.

A source pack must define:

- `sourceId`, for example `bun`.
- Display name.
- Allowed source URL patterns.
- Index/discovery strategy.
- Page fetch strategy.
- Content normalization strategy.
- Chunking defaults.
- Source-specific metadata extraction.
- Default refresh policy.
- Citation URL policy.

V1 must implement only the Bun source pack, but database schema, retrieval services, and MCP tool inputs must support future source IDs.

### Official Source Policy

For V1 remote docs tools, the only external source class is official Bun documentation:

- `https://bun.com/docs/llms.txt`
- `https://bun.com/docs/llms-full.txt`
- Individual pages under `https://bun.com/docs/`

The server and worker must reject non-allowlisted URLs. Future source packs may add official domains only through PRD updates and source allowlist tests.

## 7. MCP Tools

The remote HTTP server exposes docs-only tools. Local project-analysis tools remain available through the local stdio server, not through the remote docs server.

All docs tool responses must include:

- `generatedAt`: ISO timestamp.
- `sourceId`: source identifier, such as `bun`.
- `cacheStatus` or `freshness`: `"fresh"`, `"stale"`, `"missing"`, or `"refreshing"`.
- `sources`: cited source URLs and metadata.
- `confidence`: `"high"`, `"medium"`, or `"low"`.
- `retrieval`: retrieval mode, scores, and ranking metadata.
- `warnings`: risks, stale data, missing data, or refresh status.

### 7.1 `search_docs`

Purpose: Search indexed official documentation with hybrid retrieval.

Input:

```json
{
  "query": "string",
  "sourceId": "bun?",
  "limit": "number?",
  "mode": "hybrid | keyword | semantic?",
  "forceRefresh": "boolean?"
}
```

Defaults:

- `sourceId`: `"bun"`.
- `limit`: `5`.
- `mode`: `"hybrid"`.
- `forceRefresh`: `false`.

Output fields:

- `query`
- `sourceId`
- `mode`
- `results`
- `sources`
- `freshness`
- `confidence`
- `retrieval`
- `refreshQueued`
- `refreshReason`
- `warnings`

Each result must include:

- `title`
- `url`
- `headingPath`
- `snippet`
- `chunkId`
- `pageId`
- `score`
- `keywordScore`
- `vectorScore`
- `rerankScore`
- `fetchedAt`
- `indexedAt`
- `contentHash`

Requirements:

- Hybrid mode must combine keyword/full-text and vector search.
- Keyword mode must work without embedding generation.
- Semantic mode must use the configured embedding provider.
- Exact API names, CLI flags, package names, and code identifiers must receive keyword protection so vector similarity cannot bury exact matches.
- Results must cite official source URLs.
- Results must not fabricate content when no indexed or fetched evidence exists.
- Low-confidence or stale results may enqueue refresh, but search must return promptly with the best available evidence.

### 7.2 `get_doc_page`

Purpose: Retrieve one official documentation page from the DB, or fetch and enqueue/index it when missing or stale.

Input:

```json
{
  "sourceId": "bun?",
  "url": "string",
  "forceRefresh": "boolean?"
}
```

Output fields:

- `sourceId`
- `url`
- `title`
- `content`
- `chunks`
- `fetchedAt`
- `indexedAt`
- `contentHash`
- `freshness`
- `refreshQueued`
- `warnings`
- `sources`

Requirements:

- URL must pass the source pack allowlist.
- Disallowed URLs must return a structured error.
- Missing allowlisted pages may be fetched on demand.
- Stale pages may enqueue refresh.
- If a page has been tombstoned after repeated 404/410 confirmation, the tool must return a clear tombstone response instead of silently searching elsewhere.

### 7.3 `search_bun_docs`

Purpose: Compatibility wrapper for Bun-specific docs search.

Input:

```json
{
  "query": "string",
  "topic": "runtime | package-manager | test-runner | bundler | typescript | workspaces | deployment | security | unknown?",
  "limit": "number?",
  "forceRefresh": "boolean?"
}
```

Requirements:

- Internally call the same retrieval path as `search_docs` with `sourceId: "bun"`.
- Preserve current client expectations where practical.
- Return richer retrieval and freshness metadata.
- Do not keep a separate search implementation that can drift from `search_docs`.

### 7.4 Admin Refresh Tool

V1 should not expose a general remote-agent refresh tool by default. Manual refresh should start as a worker command.

If an MCP admin refresh tool is added later, it must:

- Be disabled by default.
- Require explicit admin configuration.
- Be rate-limited.
- Deduplicate jobs.
- Never allow non-allowlisted URLs.
- Return job status, not block until full ingestion completes.

## 8. MCP Resources

Remote docs resources should be read-only and backed by the same database.

### 8.1 `docs://sources`

Purpose: List configured documentation source packs.

Output:

- `sourceId`
- `displayName`
- `enabled`
- `allowedHosts`
- `lastIndexedAt`
- `pageCount`
- `chunkCount`

### 8.2 `docs://page/{sourceId}/{pageId}`

Purpose: Expose a stored documentation page by internal page ID.

Requirements:

- Must not permit arbitrary URL fetch through template manipulation.
- Must return structured error when unavailable.
- Must include source URL, title, content hash, fetched timestamp, indexed timestamp, and freshness status.

### 8.3 `docs://chunk/{sourceId}/{chunkId}`

Purpose: Expose one stored chunk for auditability.

Requirements:

- Must include heading path, source URL, content hash, and neighboring chunk pointers when available.
- Must not expose content from disabled or disallowed source packs.

## 9. Data Contracts

### 9.1 Database Entities

The implementation should use migrations and typed access functions. The exact ORM/query layer can be decided during implementation, but the schema must represent these concepts.

#### `doc_sources`

- `id`
- `source_id`
- `display_name`
- `enabled`
- `allowed_url_patterns`
- `default_ttl_seconds`
- `created_at`
- `updated_at`

#### `doc_pages`

- `id`
- `source_id`
- `url`
- `canonical_url`
- `title`
- `content`
- `content_hash`
- `http_status`
- `fetched_at`
- `indexed_at`
- `expires_at`
- `tombstoned_at`
- `tombstone_reason`
- `created_at`
- `updated_at`

#### `doc_chunks`

- `id`
- `source_id`
- `page_id`
- `url`
- `title`
- `heading_path`
- `chunk_index`
- `content`
- `content_hash`
- `token_estimate`
- `search_vector`
- `created_at`
- `updated_at`

#### `doc_embeddings`

- `id`
- `chunk_id`
- `provider`
- `model`
- `embedding_version`
- `dimensions`
- `embedding`
- `created_at`

The `embedding` column must use a `pgvector` vector type compatible with the configured embedding dimensions. If embedding dimensions change, implementation must create a new embedding version rather than corrupting existing vectors.

#### `doc_refresh_jobs`

- `id`
- `source_id`
- `url`
- `job_type`: `"source_index" | "page" | "embedding" | "tombstone_check"`
- `reason`: `"scheduled" | "missing_content" | "stale_content" | "low_confidence" | "manual"`
- `status`: `"queued" | "running" | "succeeded" | "failed" | "deduplicated"`
- `priority`
- `attempt_count`
- `last_error`
- `run_after`
- `started_at`
- `finished_at`
- `created_at`
- `updated_at`

#### `doc_retrieval_events`

- `id`
- `source_id`
- `query_hash`
- `mode`
- `result_count`
- `confidence`
- `low_confidence`
- `refresh_queued`
- `created_at`

Queries may be hashed for telemetry. Do not store raw user queries in telemetry unless explicitly configured.

### 9.2 Retrieval Result Contract

Every search result must be traceable to a chunk and page:

```json
{
  "chunkId": "string",
  "pageId": "string",
  "title": "string",
  "url": "string",
  "headingPath": ["string"],
  "snippet": "string",
  "score": "number",
  "keywordScore": "number",
  "vectorScore": "number",
  "rerankScore": "number",
  "fetchedAt": "ISO timestamp",
  "indexedAt": "ISO timestamp",
  "contentHash": "string"
}
```

### 9.3 Embedding Provider Contract

The embedding layer must be replaceable behind an interface.

Required behavior:

- Generate embeddings for batches of text.
- Report provider name, model, dimensions, and embedding version.
- Validate vector dimensions before writing.
- Surface rate-limit and provider failures as structured errors.
- Support deterministic fake embeddings in tests.

Default provider:

- Provider: OpenAI.
- Default model: `text-embedding-3-small`, unless implementation revalidation chooses a better default.
- Configurable model: required.

## 10. Refresh And Ingestion Requirements

### 10.1 Worker Model

Docs ingestion must be implemented as a worker path separate from the HTTP request path.

The same codebase and Docker image may provide multiple commands:

```bash
bun src/http.ts
bun src/docs-worker.ts
```

The HTTP server must remain responsive while refresh jobs run. The worker owns source discovery, page fetching, normalization, chunking, embedding, job retry, and tombstone checks.

### 10.2 Scheduled Refresh

The worker must support configurable scheduled refresh.

Default:

- Refresh interval: weekly.
- Source: Bun.
- Scope: known source index and pages prioritized by refresh score.

Example environment variables:

```text
DOCS_REFRESH_INTERVAL=7d
DOCS_REFRESH_MAX_PAGES_PER_RUN=500
DOCS_REFRESH_MAX_EMBEDDINGS_PER_RUN=2000
DOCS_REFRESH_MAX_CONCURRENCY=4
```

### 10.3 On-Demand Refresh

Docs tools may enqueue refresh jobs when:

- Content is missing.
- Content is stale.
- Search confidence is low.
- A requested allowlisted page is not in the DB.
- A page has repeated fetch failures and needs tombstone confirmation.

On-demand refresh must be bounded:

- Deduplicate by source, URL, job type, and pending status.
- Apply per-source rate limits.
- Apply global queue limits.
- Never block search indefinitely.
- Return `refreshQueued: true` when a job is created.
- Return `refreshQueued: false` with a reason when a job is skipped or already queued.

### 10.4 Refresh Priority

Refresh priority should be score-driven. The exact formula can evolve, but the inputs must include:

- Age of content.
- Recent access frequency.
- Stale-result hits.
- Low-confidence search events related to the source.
- Repeated fetch or embedding failures.

Conceptual formula:

```text
refreshPriority =
  agePressure
  + recentRequestBoost
  + staleHitBoost
  + lowConfidenceQueryBoost
  - recentFailurePenalty
```

Low retrieval score must not delete content. Deletion/tombstoning should happen only after source evidence indicates removal, such as repeated 404 or 410 responses from an allowlisted official URL.

## 11. Security Requirements

- Every HTTP request to `/mcp` must include `Authorization: Bearer <token>`.
- The bearer token must be configured through environment variables.
- Tokens must not be accepted in query strings.
- Invalid or missing tokens must return HTTP 401 without leaking details.
- The HTTP server must validate `Origin` when present.
- Production deployments should run behind HTTPS or a TLS-terminating proxy.
- The server must not expose remote project-analysis tools.
- Remote docs tools must not accept or dereference local filesystem paths.
- URL fetching must use source-pack allowlists.
- Redirects must be revalidated against allowlists.
- Request bodies must have size limits.
- Search limits must have maximum bounds.
- Worker concurrency must be bounded.
- Embedding provider errors and rate limits must not crash the MCP server.
- Logs must not include bearer tokens, raw authorization headers, or full embedding payloads.
- Audit/debug logs must redact sensitive environment-derived values.
- Database credentials and OpenAI API keys must be configured through environment variables, not checked into source.

## 12. Performance And Optimization Requirements

- Search must target low-latency reads from Postgres.
- Hybrid retrieval must avoid embedding the same query multiple times per request.
- Query embeddings may be cached in memory with bounded TTL when safe.
- Chunk embeddings must be generated in batches.
- Worker jobs must be idempotent.
- Page fetches must avoid re-embedding unchanged content hashes.
- Full-text search must use indexed `tsvector` data.
- Vector search must use `pgvector` indexes when data size justifies approximate nearest neighbor search.
- HNSW should be considered before IVFFlat for retrieval-heavy workloads unless implementation benchmarks show otherwise.
- Search responses must remain compact and include snippets rather than full pages.
- `get_doc_page` may return full content, but should expose chunked output for large pages.
- The implementation must include tests that prevent accidental unbounded result limits.

## 13. Deployment And Configuration

The first deployment target is Docker on a VPS or container runtime such as DigitalOcean.

Expected services:

```text
mcp-http-server
docs-worker
postgres-pgvector
```

Required environment variables:

```text
MCP_HTTP_HOST=0.0.0.0
MCP_HTTP_PORT=3000
MCP_BEARER_TOKEN=...
DATABASE_URL=postgres://...
EMBEDDING_PROVIDER=openai
OPENAI_API_KEY=...
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
DOCS_REFRESH_INTERVAL=7d
```

Optional environment variables:

```text
DOCS_REFRESH_MAX_PAGES_PER_RUN=500
DOCS_REFRESH_MAX_EMBEDDINGS_PER_RUN=2000
DOCS_REFRESH_MAX_CONCURRENCY=4
DOCS_SEARCH_DEFAULT_LIMIT=5
DOCS_SEARCH_MAX_LIMIT=20
DOCS_ALLOWED_ORIGINS=https://agent.example.com
```

The implementation should include a Dockerfile and local compose example only when the task series reaches deployment work. Secrets must be referenced through environment variables or env files and must not be committed.

The HTTP server command should start the Hono application on Bun. The worker command should not start Hono or expose HTTP routes.

## 14. TDD Implementation Workflow

Implementation must be sequential and test-driven.

Before starting implementation:

1. Revalidate MCP Streamable HTTP SDK package imports and examples.
2. Revalidate OpenAI embedding model names and API shape.
3. Revalidate `pgvector` installation/indexing behavior for the selected Postgres image.
4. Update this PRD if any source assumption changed.
5. Create task files and tracker entries before code changes.

For every task:

1. Mark exactly one task as `in_progress`.
2. Write failing tests first.
3. Implement the smallest change that satisfies the tests.
4. Run the relevant focused tests.
5. Run `bun run typecheck` when TypeScript contracts change.
6. Run `bun run check` before task completion.
7. Update tracker work log with concise validation notes.
8. Commit that task alone with a descriptive message covering files, affected area, and motivation.

Do not batch unrelated tasks into one commit. Do not refactor unrelated code while implementing a task.

## 15. Required Test Categories

### HTTP Transport

- Hono app exposes `GET /healthz`.
- Hono app exposes `GET /readyz`.
- Hono app routes `POST /mcp` to Streamable HTTP transport.
- Hono app routes `GET /mcp` according to Streamable HTTP transport support.
- Hono app routes `DELETE /mcp` according to Streamable HTTP session termination support.
- `/mcp` rejects missing bearer token.
- `/mcp` rejects invalid bearer token.
- `/mcp` accepts valid bearer token.
- Authorization header is required on every request.
- Token in query string is rejected.
- Invalid `Origin` is rejected when origin validation is configured.
- Request bodies above the configured limit are rejected before MCP handling.
- Deprecated HTTP+SSE endpoints are not exposed.
- Streamable HTTP initialization works with the selected SDK package.

### Server Surface

- Remote HTTP server registers docs-only tools.
- Remote HTTP server does not register project-analysis tools.
- Existing stdio server still registers existing local tools.
- `search_bun_docs` delegates to the generic docs retrieval service.

### Source Allowlist

- Official Bun docs URLs are accepted.
- Non-Bun domains are rejected.
- `http://` Bun URLs are rejected.
- Hostname tricks are rejected.
- Encoded path traversal and redirect-to-disallowed-host cases are rejected.
- Allowlist behavior is source-pack based.

### Database And Migrations

- Migrations create required tables and indexes.
- `pgvector` extension is required or startup fails with a structured error.
- Chunk rows link to page and source rows.
- Embedding rows record provider, model, dimensions, and version.
- Dimension mismatch is rejected.
- Unchanged content hashes do not create duplicate chunks or embeddings.

### Ingestion And Chunking

- Bun docs index is fetched from official source.
- Known Bun docs pages are fetched and normalized.
- Chunking preserves heading paths.
- Chunking creates stable content hashes.
- Secret or local filesystem content cannot enter docs ingestion.
- Deleted pages are tombstoned only after confirmed source removal policy.

### Embedding Provider

- OpenAI provider batches embedding requests.
- Fake provider produces deterministic embeddings for tests.
- Provider failures create failed jobs without crashing HTTP search.
- Rate-limit responses are retried according to policy.
- Provider/model switch creates a new embedding version.

### Retrieval

- Keyword search finds exact API names such as `Bun.serve`.
- Keyword search finds CLI flags and package-manager terms.
- Semantic search finds relevant docs for natural-language queries.
- Hybrid search merges keyword and vector results without duplicates.
- Exact matches are not buried by semantic-only results.
- Results include chunk/page IDs, URLs, heading paths, scores, and freshness.
- Empty or low-confidence results include warnings and may enqueue refresh.
- Result limits are bounded.

### Refresh Jobs

- Scheduled refresh queues jobs according to configured interval.
- On-demand refresh queues missing content jobs.
- On-demand refresh queues stale content jobs.
- Low-confidence search can queue refresh without blocking response.
- Duplicate pending jobs are deduplicated.
- Refresh priority increases with age and access frequency.
- Recent failures reduce priority or delay retry.
- Worker respects concurrency and per-run limits.

### Deployment

- Docker image can run HTTP server command.
- Docker image can run docs worker command.
- Compose example wires HTTP server, worker, and Postgres.
- Required env vars are validated at startup.
- Missing secrets fail safely.

## 16. Acceptance Criteria For Future Implementation

The implementation is complete only when:

- Existing stdio behavior still works and existing deterministic tests pass.
- A remote Streamable HTTP server starts on `/mcp`.
- The remote HTTP server uses Hono as the application framework on Bun.
- Health and readiness routes are available and covered by tests.
- Bearer-token auth is enforced for every HTTP MCP request.
- Remote HTTP exposes docs-only tools.
- Remote HTTP does not expose local project-analysis tools.
- Bun docs can be ingested into Postgres.
- Bun docs chunks are embedded through the configured embedding provider.
- Search uses hybrid retrieval over Postgres full-text search and `pgvector`.
- Search results include citations, freshness, chunk IDs, page IDs, and scores.
- `get_doc_page` retrieves stored pages and handles allowlisted missing/stale pages safely.
- Scheduled refresh is configurable and defaults to weekly.
- On-demand refresh is deduplicated, bounded, and non-blocking by default.
- The worker handles refresh, embedding, retries, and tombstones outside the HTTP request path.
- Tests cover security, transport, source allowlist, ingestion, embeddings, retrieval, refresh, and deployment configuration.
- `bun test` passes.
- `bun run typecheck` passes.
- `bun run check` passes.
- Documentation explains Docker deployment, auth, source policy, refresh behavior, and the local-vs-remote split.
- Implementation tasks are committed one task at a time with descriptive commit messages.

## 16.1 Stop Conditions

The implementation effort should continue task by task until one of these conditions is met:

### Project Conclusion

The project is concluded when all task files in `docs/tasks/bun-dev-intel-mcp-remote-docs-http/` are marked `done` in `TRACKER.md`, all acceptance criteria in this PRD are satisfied, final traceability documentation maps PRD requirements to implementation and tests, and the final quality gates pass:

```bash
bun test
bun run typecheck
bun run check
```

At conclusion, no task should remain `todo`, `in_progress`, or `blocked`, and the tracker must contain a final work-log entry summarizing the completed implementation, validation results, and any residual operational notes.

### Major Blocker

The implementation should stop and report a blocker when the active agent cannot safely proceed after reasonable investigation and after considering whether a narrow delegated agent can help.

Major blockers include:

- Required official MCP, Hono, Postgres, pgvector, OpenAI, or Bun behavior contradicts this PRD and requires a product decision.
- A required dependency or runtime capability is unavailable or incompatible in a way that cannot be solved by a small, well-scoped implementation change.
- Required tests cannot be made deterministic without changing the architecture or acceptance criteria.
- Security requirements conflict with requested behavior.
- Database, transport, or deployment requirements require secrets, infrastructure access, or external approvals not available to the agent.
- Continuing would require broad architectural drift from the existing project structure.

When stopping for a blocker, the agent must update `TRACKER.md` with the blocked task, what was attempted, the exact unresolved decision or missing capability, and the recommended next decision. It must not mark the project complete.

## 17. Suggested Future Project Shape

Keep the current project structure and add narrowly scoped folders. Avoid architectural drift by extending existing layers instead of inventing a second application layout.

Suggested additions:

```text
.
├── src
│   ├── http.ts
│   ├── docs-worker.ts
│   ├── docs
│   │   ├── sources
│   │   ├── ingestion
│   │   ├── retrieval
│   │   ├── embeddings
│   │   ├── refresh
│   │   └── storage
│   ├── server.ts
│   ├── stdio.ts
│   ├── tools
│   ├── resources
│   ├── sources
│   ├── security
│   └── shared
├── migrations
├── tests
│   ├── unit
│   ├── integration
│   └── e2e
└── docs
    ├── prd
    └── tasks
```

Guidance:

- Reuse `src/server.ts` registration patterns where possible.
- Keep transport entrypoints separate from capability registration.
- Keep docs storage/retrieval separate from current source fetch adapters until integration is intentional.
- Keep Bun source-pack code isolated so future source packs can be added without modifying retrieval internals.
- Keep existing local project analyzers unchanged unless a task explicitly requires a shared utility extraction.

## 18. Source Baseline

Future implementation must verify current docs again before coding. These links were used to shape this PRD:

- MCP Streamable HTTP transport specification: `https://modelcontextprotocol.io/specification/2025-11-25/basic/transports`
- MCP authorization specification: `https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization`
- MCP TypeScript SDK server docs: `https://ts.sdk.modelcontextprotocol.io/documents/server.html`
- MCP TypeScript SDK Streamable HTTP examples: `https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.x/src/examples/server`
- MCP TypeScript SDK middleware packages: `https://github.com/modelcontextprotocol/typescript-sdk`
- Hono getting started docs: `https://hono.dev/docs/getting-started/basic`
- Hono Web Standards docs: `https://hono.dev/docs/concepts/web-standard`
- OpenAI embeddings guide: `https://platform.openai.com/docs/guides/embeddings`
- OpenAI embedding models: `https://platform.openai.com/docs/models/embedding-3`
- pgvector repository and README: `https://github.com/pgvector/pgvector`
- PostgreSQL full-text search docs: `https://www.postgresql.org/docs/current/textsearch.html`
- Docker Compose services docs: `https://docs.docker.com/reference/compose-file/services/`
- Docker Compose environment variable docs: `https://docs.docker.com/compose/how-tos/environment-variables/set-environment-variables/`
- Bun docs index: `https://bun.com/docs/llms.txt`
- Bun full docs: `https://bun.com/docs/llms-full.txt`

## 19. Open Questions For Later Review

- Should the first implementation use `@modelcontextprotocol/sdk` instead of the current `@modelcontextprotocol/server` package?
- Which official MCP Hono or Web Standards transport package should be used after SDK revalidation?
- Should the HTTP docs server and local stdio server share one `McpServer` registration module with filtered capabilities, or have separate registration functions?
- Which Postgres image should be used for local development and CI with `pgvector` enabled?
- Should the default OpenAI embedding model be `text-embedding-3-small` for cost or `text-embedding-3-large` for quality?
- Should raw user queries be stored at all, or should retrieval telemetry only store hashes and aggregate counters?
- Should manual refresh be CLI-only in V1, or should an admin-only MCP tool be added after auth scopes exist?
- Should stale content be returned indefinitely with warnings, or should there be a maximum stale age after which no answer is returned?
- Should search use a deterministic reranker first, or add a model-based reranker in a later version?

## 20. Task Files And Tracker

The implementation task plan is split into one file per task under `docs/tasks/bun-dev-intel-mcp-remote-docs-http/`.

Use the same tracker discipline as the existing project:

- Start from a tracker.
- Keep exactly one task `in_progress`.
- Read only the active task file.
- Write failing tests before implementation.
- Complete one sequential increment at a time.
- Commit once per completed task with a descriptive message.

Task control plane:

- Tracker: [docs/tasks/bun-dev-intel-mcp-remote-docs-http/TRACKER.md](../tasks/bun-dev-intel-mcp-remote-docs-http/TRACKER.md)

Task files:

- [00 - Revalidate official sources and implementation assumptions](../tasks/bun-dev-intel-mcp-remote-docs-http/00-revalidate-official-sources.md)
- [01 - Select MCP SDK/package plan and dependency baseline](../tasks/bun-dev-intel-mcp-remote-docs-http/01-select-sdk-and-dependency-plan.md)
- [02 - Partition docs-only remote capabilities from local stdio capabilities](../tasks/bun-dev-intel-mcp-remote-docs-http/02-capability-partition-docs-only-server.md)
- [03 - Implement Hono HTTP shell, auth, health, and readiness](../tasks/bun-dev-intel-mcp-remote-docs-http/03-hono-http-shell-auth-health.md)
- [04 - Wire Streamable HTTP MCP endpoint](../tasks/bun-dev-intel-mcp-remote-docs-http/04-streamable-http-mcp-endpoint.md)
- [05 - Add runtime configuration and security validation](../tasks/bun-dev-intel-mcp-remote-docs-http/05-runtime-config-and-security-validation.md)
- [06 - Add Postgres and pgvector migrations](../tasks/bun-dev-intel-mcp-remote-docs-http/06-postgres-pgvector-schema-migrations.md)
- [07 - Add database access layer and test harness](../tasks/bun-dev-intel-mcp-remote-docs-http/07-database-test-harness-and-storage-access.md)
- [08 - Define source-pack contract and Bun allowlist](../tasks/bun-dev-intel-mcp-remote-docs-http/08-source-pack-contract-and-bun-allowlist.md)
- [09 - Implement Bun docs discovery, fetch, and normalization](../tasks/bun-dev-intel-mcp-remote-docs-http/09-bun-docs-discovery-fetch-normalization.md)
- [10 - Implement documentation chunking and hashing](../tasks/bun-dev-intel-mcp-remote-docs-http/10-doc-chunking-and-hashing.md)
- [11 - Add embedding provider contract and deterministic fake provider](../tasks/bun-dev-intel-mcp-remote-docs-http/11-embedding-provider-interface-and-fake.md)
- [12 - Add OpenAI embedding provider](../tasks/bun-dev-intel-mcp-remote-docs-http/12-openai-embedding-provider.md)
- [13 - Store ingested pages, chunks, and embeddings](../tasks/bun-dev-intel-mcp-remote-docs-http/13-ingestion-pipeline-store-pages-chunks-embeddings.md)
- [14 - Implement Postgres full-text keyword retrieval](../tasks/bun-dev-intel-mcp-remote-docs-http/14-keyword-retrieval-postgres-fts.md)
- [15 - Implement pgvector semantic retrieval](../tasks/bun-dev-intel-mcp-remote-docs-http/15-vector-retrieval-pgvector.md)
- [16 - Implement hybrid ranking, snippets, and confidence](../tasks/bun-dev-intel-mcp-remote-docs-http/16-hybrid-ranking-confidence-snippets.md)
- [17 - Implement search_docs MCP tool](../tasks/bun-dev-intel-mcp-remote-docs-http/17-search-docs-tool.md)
- [18 - Implement get_doc_page and docs resources](../tasks/bun-dev-intel-mcp-remote-docs-http/18-get-doc-page-and-doc-resources.md)
- [19 - Migrate search_bun_docs to docs retrieval compatibility wrapper](../tasks/bun-dev-intel-mcp-remote-docs-http/19-search-bun-docs-compatibility.md)
- [20 - Add refresh job queue, dedupe, and priority scoring](../tasks/bun-dev-intel-mcp-remote-docs-http/20-refresh-job-queue-and-priority.md)
- [21 - Implement docs worker scheduled and on-demand refresh](../tasks/bun-dev-intel-mcp-remote-docs-http/21-docs-worker-scheduled-and-demand-refresh.md)
- [22 - Implement stale content and tombstone policy](../tasks/bun-dev-intel-mcp-remote-docs-http/22-tombstone-stale-policy.md)
- [23 - Add Docker and deployment configuration](../tasks/bun-dev-intel-mcp-remote-docs-http/23-docker-compose-deployment.md)
- [24 - Add final QA, documentation, and traceability](../tasks/bun-dev-intel-mcp-remote-docs-http/24-final-qa-docs-traceability.md)
