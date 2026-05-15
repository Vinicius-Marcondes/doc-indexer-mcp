# Tracker: Remote Docs Intelligence MCP Over Streamable HTTP

Use this tracker as the implementation control plane for [the remote docs HTTP PRD](../../prd/bun-dev-intel-mcp-remote-docs-http.md).

Keep it short, current, and factual. Do not paste long logs, command output, or design debates here.

## Tracker Instructions

Before starting work:

1. Read [the PRD](../../prd/bun-dev-intel-mcp-remote-docs-http.md).
2. Read this tracker.
3. Read only the task file for the next task.
4. Update `Current Task` with task ID, title, owner, status, started date, planned validation, and commit intent.
5. Add one short `Work Log` entry.

While working:

- Keep exactly one task `in_progress`.
- Write failing tests before implementation.
- Keep implementation within the current task's stated scope.
- If scope changes, pause and update the PRD before continuing.
- If a blocker appears, record it and leave the task status as `blocked`.
- Keep test notes short: command name, pass/fail, and the important reason.

After finishing a task:

1. Mark the task `done` in `Task Status`.
2. Record focused tests and final gate results.
3. Add a completion `Work Log` entry.
4. Commit only that task's work with a descriptive commit message.
5. Clear or advance `Current Task`.

Commit message requirement:

- Mention the goal.
- Mention the affected files or areas.
- Mention why the change was needed.
- Do not bundle unrelated task work.

## Current Task

- Task ID: none
- Title: Project conclusion
- Owner: Codex
- Status: done
- Started: 2026-05-14
- Planned validation: `bun test tests/e2e/remote-docs-http-flow.test.ts tests/unit/deployment/remote-docs-handoff.test.ts` pass; `bun test` pass; `bun run typecheck` pass; `bun run check` pass
- Commit intent: Commit final QA, documentation, traceability, and tracker conclusion for the remote docs HTTP project.
- Notes: All tasks 00-24 are done. A later split moved local stdio and admin into sibling repositories (`bun-dev-intel-stdio-mcp` and `bun-dev-intel-admin-console`); this repository now owns only remote docs HTTP MCP and worker behavior.

## Task Status

| Task | Title | Status | Task File |
| --- | --- | --- | --- |
| 00 | Revalidate official sources and implementation assumptions | done | [00](00-revalidate-official-sources.md) |
| 01 | Select MCP SDK/package plan and dependency baseline | done | [01](01-select-sdk-and-dependency-plan.md) |
| 02 | Partition docs-only remote capabilities from local stdio capabilities | done | [02-capability-partition-docs-only-server.md](02-capability-partition-docs-only-server.md) |
| 03 | Implement Hono HTTP shell, auth, health, and readiness | done | [03](03-hono-http-shell-auth-health.md) |
| 04 | Wire Streamable HTTP MCP endpoint | done | [04](04-streamable-http-mcp-endpoint.md) |
| 05 | Add runtime configuration and security validation | done | [05](05-runtime-config-and-security-validation.md) |
| 06 | Add Postgres and pgvector migrations | done | [06](06-postgres-pgvector-schema-migrations.md) |
| 07 | Add database access layer and test harness | done | [07](07-database-test-harness-and-storage-access.md) |
| 08 | Define source-pack contract and Bun allowlist | done | [08](08-source-pack-contract-and-bun-allowlist.md) |
| 09 | Implement Bun docs discovery, fetch, and normalization | done | [09](09-bun-docs-discovery-fetch-normalization.md) |
| 10 | Implement documentation chunking and hashing | done | [10](10-doc-chunking-and-hashing.md) |
| 11 | Add embedding provider contract and deterministic fake provider | done | [11](11-embedding-provider-interface-and-fake.md) |
| 12 | Add OpenAI embedding provider | done | [12](12-openai-embedding-provider.md) |
| 13 | Store ingested pages, chunks, and embeddings | done | [13](13-ingestion-pipeline-store-pages-chunks-embeddings.md) |
| 14 | Implement Postgres full-text keyword retrieval | done | [14](14-keyword-retrieval-postgres-fts.md) |
| 15 | Implement pgvector semantic retrieval | done | [15](15-vector-retrieval-pgvector.md) |
| 16 | Implement hybrid ranking, snippets, and confidence | done | [16](16-hybrid-ranking-confidence-snippets.md) |
| 17 | Implement `search_docs` MCP tool | done | [17](17-search-docs-tool.md) |
| 18 | Implement `get_doc_page` and docs resources | done | [18](18-get-doc-page-and-doc-resources.md) |
| 19 | Migrate `search_bun_docs` to docs retrieval compatibility wrapper | done | [19](19-search-bun-docs-compatibility.md) |
| 20 | Add refresh job queue, dedupe, and priority scoring | done | [20](20-refresh-job-queue-and-priority.md) |
| 21 | Implement docs worker scheduled and on-demand refresh | done | [21](21-docs-worker-scheduled-and-demand-refresh.md) |
| 22 | Implement stale content and tombstone policy | done | [22](22-tombstone-stale-policy.md) |
| 23 | Add Docker and deployment configuration | done | [23](23-docker-compose-deployment.md) |
| 24 | Add final QA, documentation, and traceability | done | [24](24-final-qa-docs-traceability.md) |

## Work Log

| Date | Task | Status | Notes |
| --- | --- | --- | --- |
| 2026-05-14 | Planning | done | Split remote docs HTTP PRD into per-task implementation files and initialized tracker. No implementation started. |
| 2026-05-14 | 00 | in_progress | Started official source revalidation before implementation; product tests not required for this docs-only task. |
| 2026-05-14 | 00 | done | Added source revalidation note; no PRD correction required. `test -f source-revalidation.md` pass; `bun run check` pass (279 pass, 2 live skipped). |
| 2026-05-14 | 01 | in_progress | Started dependency baseline task; will add failing scaffold/import smoke tests before package changes. |
| 2026-05-14 | 01 | done | Added Hono, MCP Hono adapter, Postgres, and OpenAI dependency baseline plus package-plan/import tests. Published MCP stdio subpath still fails in this workspace, so local stdio shim remains. Focused tests pass; `bun run typecheck` pass; `bun run check` pass (283 pass, 2 live skipped). |
| 2026-05-14 | 02 | in_progress | Started capability partition task; will add failing remote docs registration tests before refactoring server registration. |
| 2026-05-14 | 02 | done | Added docs-only remote capability manifest/registration path while keeping local stdio registration unchanged. Focused MCP registration/stdio tests pass; `bun run typecheck` pass; `bun run check` pass (286 pass, 2 live skipped). |
| 2026-05-14 | 03 | in_progress | Started Hono HTTP shell task; will add failing auth/health/readiness/body-limit tests before implementation. |
| 2026-05-14 | 03 | done | Added Hono HTTP app shell with health/readiness, bearer auth, origin/query-token rejection, body limit, and protected `/mcp` placeholder. HTTP and MCP focused tests pass; `bun run typecheck` pass; `bun run check` pass (295 pass, 2 live skipped). |
| 2026-05-14 | 04 | in_progress | Started Streamable HTTP endpoint task; will add failing MCP initialize/list/routing and startup-safety tests before transport wiring. |
| 2026-05-14 | 04 | done | Wired `/mcp` to SDK Streamable HTTP transport with docs-only remote server registration and startup-safe `src/http.ts`; deprecated SSE routes absent. Focused HTTP/MCP/stdio tests pass; `bun run typecheck` pass; `bun run check` pass (301 pass, 2 live skipped). |
| 2026-05-14 | 05 | in_progress | Started runtime config task; will add failing config validation/redaction tests before implementation. |
| 2026-05-14 | 05 | done | Added typed remote docs config parser with required env, weak-token rejection, refresh/search limit validation, redacted errors, and HTTP startup/app integration. Focused config/Hono tests pass; `bun run typecheck` pass; `bun run check` pass (311 pass, 2 live skipped). |
| 2026-05-14 | 06 | in_progress | Started pgvector schema task; will add failing ordered migration tests plus a `TEST_DATABASE_URL`-gated real Postgres integration test before SQL migration. |
| 2026-05-14 | 06 | done | Added ordered pgvector schema migration for sources, pages, chunks, embeddings, refresh jobs, and retrieval events. Migration file tests pass; real Postgres execution test is gated/skipped without `TEST_DATABASE_URL`; `bun run typecheck` pass; `bun run check` pass (313 pass, 3 skipped). |
| 2026-05-14 | 07 | in_progress | Started storage access task; will add failing storage API, DB harness, dimension validation, and readiness tests before implementation. |
| 2026-05-14 | 07 | done | Added typed docs storage access, migration runner, DB readiness helper, and isolated Postgres test harness. Focused storage/Hono tests pass; real storage integration is gated/skipped without `TEST_DATABASE_URL`; `bun run typecheck` pass; `bun run check` pass (316 pass, 4 skipped). |
| 2026-05-14 | 08 | in_progress | Started source-pack task; will add failing Bun allowlist/registry tests before implementation. |
| 2026-05-14 | 08 | done | Added docs source-pack contract, Bun source pack allowlist, redirect revalidation, and source registry. Focused source-pack and existing allowlist tests pass; `bun run typecheck` pass; `bun run check` pass (324 pass, 4 skipped). |
| 2026-05-14 | 09 | in_progress | Started Bun docs discovery/fetch/normalization task; will add failing normalizer and mocked discovery tests before implementation. |
| 2026-05-14 | 09 | done | Added injectable Bun docs discovery, page fetch, final-URL revalidation, and deterministic markdown/HTML normalization. Focused new and existing Bun docs adapter tests pass; `bun run typecheck` pass; `bun run check` pass (333 pass, 4 skipped). |
| 2026-05-14 | 10 | in_progress | Started chunking task; will add failing deterministic chunking/hash tests before implementation. |
| 2026-05-14 | 10 | done | Added deterministic docs chunking with heading paths, token estimates, stable page/chunk hashes, and neighbor indexes. Focused chunking tests pass; `bun run typecheck` pass; `bun run check` pass (340 pass, 4 skipped). |
| 2026-05-14 | 11 | in_progress | Started embedding provider contract task; will add failing fake provider and vector validation tests before implementation. |
| 2026-05-14 | 11 | done | Added provider-agnostic embedding contract, deterministic fake provider, structured provider failure helper, and vector dimension validation. Focused embedding tests pass; `bun run typecheck` pass; `bun run check` pass (347 pass, 4 skipped). |
| 2026-05-14 | 12 | in_progress | Started OpenAI embedding provider task; official docs still show `text-embedding-3-small`, `v1/embeddings`, `encoding_format: "float"`, and 1536 default dimensions. Will add mocked SDK tests before implementation. |
| 2026-05-14 | 12 | done | Added SDK-backed OpenAI embedding provider with mocked fetch support, batching, ordered response parsing, configured model/dimensions metadata, structured retryable failures, and API-key redaction. Focused OpenAI/config tests pass; `bun run typecheck` pass; `bun run check` pass (354 pass, 4 skipped). |
| 2026-05-14 | 13 | in_progress | Started ingestion persistence task; will add failing mocked ingestion tests before orchestration/storage changes. |
| 2026-05-14 | 13 | done | Added Bun docs ingestion orchestration plus storage helpers for page lookup, chunk replacement, and embedding reuse. Focused ingestion/storage/embedding tests pass; real Postgres ingestion cases are gated/skipped without `TEST_DATABASE_URL`; `bun run typecheck` pass; `bun run check` pass (355 pass, 8 skipped). |
| 2026-05-14 | 14 | in_progress | Started keyword retrieval task; will add failing Postgres FTS and limit-bound tests before implementation. |
| 2026-05-14 | 14 | done | Added Postgres keyword retrieval with source filtering, bounded limits, generated search-vector ranking, exact code/CLI term boosts, snippets, and retrieval metadata. Focused keyword/storage tests pass; real Postgres retrieval cases are gated/skipped without `TEST_DATABASE_URL`; `bun run typecheck` pass; `bun run check` pass (356 pass, 13 skipped). |
| 2026-05-14 | 15 | in_progress | Started semantic retrieval task; will add failing pgvector and provider-failure tests before implementation. |
| 2026-05-14 | 15 | done | Added provider-backed pgvector semantic retrieval with bounded limits, source/provider/model/version filtering, structured provider failures, dimension validation, and retrieval metadata. Focused vector/embedding/storage tests pass; real Postgres vector cases are gated/skipped without `TEST_DATABASE_URL`; `bun run typecheck` pass; `bun run check` pass (359 pass, 17 skipped). |
| 2026-05-14 | 16 | in_progress | Started hybrid retrieval task; will add failing merge/ranking/confidence/telemetry tests before implementation. |
| 2026-05-14 | 16 | done | Added central hybrid retrieval with keyword/semantic modes, duplicate merging, exact-match ranking protection, freshness/confidence warnings, low-confidence refresh reason, and hashed telemetry. Focused retrieval tests pass; `bun run typecheck` pass; `bun run check` pass (367 pass, 17 skipped). |
| 2026-05-14 | 17 | in_progress | Started `search_docs` tool task; will add failing tool and remote registration tests before implementation. |
| 2026-05-14 | 17 | done | Added remote-only `search_docs` with input/source/limit validation, hybrid retrieval integration, compact cited output, and remote MCP registration while keeping local stdio tools unchanged. Focused tool/MCP tests pass; `bun run typecheck` pass; `bun run check` pass (374 pass, 17 skipped). |
| 2026-05-14 | 18 | in_progress | Started page/resource task; will add failing get_doc_page and docs resource tests before implementation. |
| 2026-05-14 | 18 | done | Added `get_doc_page`, DB-backed stored page/chunk read helpers, and read-only `docs://sources`, `docs://page/{sourceId}/{pageId}`, and `docs://chunk/{sourceId}/{chunkId}` resources with source/id validation and freshness metadata. Focused tool/resource/MCP/storage tests pass; `bun run typecheck` pass; `bun run check` pass (383 pass, 17 skipped). |
| 2026-05-14 | 19 | in_progress | Started `search_bun_docs` compatibility task; will add failing wrapper/delegation tests before implementation. |
| 2026-05-14 | 19 | done | Routed `search_bun_docs` through the generic `search_docs` retrieval path with Bun source defaults, topic query boosts, compatibility result fields, freshness/retrieval metadata, and wrapper regression tests. Focused wrapper/generic/e2e/audit tests pass; `bun run typecheck` pass; `bun run check` pass (384 pass, 17 skipped). |
| 2026-05-14 | 20 | in_progress | Started refresh queue task; will add failing enqueue/dedupe/priority/bounds tests before implementation. |
| 2026-05-14 | 20 | done | Added bounded refresh job queue with allowlist policy rejection, pending/running dedupe, priority scoring, recent-failure delay, queue bounds, and storage helpers. Focused refresh/storage tests pass; `bun run typecheck` pass; `bun run check` pass (391 pass, 17 skipped). |
| 2026-05-14 | 21 | in_progress | Started docs worker task; will add failing worker processing, scheduling, and on-demand enqueue tests before implementation. |
| 2026-05-14 | 21 | done | Added docs worker command/service, scheduled source-index enqueue, bounded runnable job claiming, page/source/embedding/tombstone execution dispatch, failed-job error capture, and non-blocking search/page refresh enqueue. Focused worker/queue/tool/storage tests pass; `bun run typecheck` pass; `bun run check` pass (403 pass, 17 skipped). |
| 2026-05-14 | 22 | in_progress | Started stale/tombstone policy task; will add failing freshness and tombstone tests before implementation. |
| 2026-05-14 | 22 | done | Added shared freshness policy, source-confirmed tombstone policy, tombstone metadata in page responses, storage tombstone helpers, and worker tombstone handling for confirmed 404/410 failures. Focused freshness/tombstone/tool/worker/retrieval tests pass; `bun run typecheck` pass; `bun run check` pass (410 pass, 17 skipped). |
| 2026-05-14 | 23 | in_progress | Started Docker deployment task; will add failing deployment config tests before adding Dockerfile, compose, env example, and docs. |
| 2026-05-14 | 23 | done | Added Dockerfile, compose stack, env example, and deployment docs for separate HTTP server, docs worker, and Postgres/pgvector services. Focused deployment config tests pass; `bun run typecheck` pass; `bun run check` pass (415 pass, 17 skipped). |
| 2026-05-14 | 24 | in_progress | Started final QA task; will add failing remote docs HTTP e2e and traceability/docs coverage before final handoff updates. |
| 2026-05-14 | 24 | done | Added remote HTTP e2e coverage, handoff docs coverage, deployment/README updates, and traceability checklist. Focused Task 24 tests pass; `bun test` pass; `bun run typecheck` pass; `bun run check` pass (419 pass, 17 skipped). |
| 2026-05-14 | Project | done | Remote Docs Intelligence MCP over Streamable HTTP is complete: all tracker tasks are done, PRD traceability is documented, stdio/local behavior remains covered, and final quality gates pass. |
