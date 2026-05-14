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
- Title: none
- Owner: none
- Status: not_started
- Started: none
- Planned validation: none
- Commit intent: none
- Notes: Task 02 completed; ready to advance to Task 03 after the focused commit.

## Task Status

| Task | Title | Status | Task File |
| --- | --- | --- | --- |
| 00 | Revalidate official sources and implementation assumptions | done | [00](00-revalidate-official-sources.md) |
| 01 | Select MCP SDK/package plan and dependency baseline | done | [01](01-select-sdk-and-dependency-plan.md) |
| 02 | Partition docs-only remote capabilities from local stdio capabilities | done | [02-capability-partition-docs-only-server.md](02-capability-partition-docs-only-server.md) |
| 03 | Implement Hono HTTP shell, auth, health, and readiness | todo | [03](03-hono-http-shell-auth-health.md) |
| 04 | Wire Streamable HTTP MCP endpoint | todo | [04](04-streamable-http-mcp-endpoint.md) |
| 05 | Add runtime configuration and security validation | todo | [05](05-runtime-config-and-security-validation.md) |
| 06 | Add Postgres and pgvector migrations | todo | [06](06-postgres-pgvector-schema-migrations.md) |
| 07 | Add database access layer and test harness | todo | [07](07-database-test-harness-and-storage-access.md) |
| 08 | Define source-pack contract and Bun allowlist | todo | [08](08-source-pack-contract-and-bun-allowlist.md) |
| 09 | Implement Bun docs discovery, fetch, and normalization | todo | [09](09-bun-docs-discovery-fetch-normalization.md) |
| 10 | Implement documentation chunking and hashing | todo | [10](10-doc-chunking-and-hashing.md) |
| 11 | Add embedding provider contract and deterministic fake provider | todo | [11](11-embedding-provider-interface-and-fake.md) |
| 12 | Add OpenAI embedding provider | todo | [12](12-openai-embedding-provider.md) |
| 13 | Store ingested pages, chunks, and embeddings | todo | [13](13-ingestion-pipeline-store-pages-chunks-embeddings.md) |
| 14 | Implement Postgres full-text keyword retrieval | todo | [14](14-keyword-retrieval-postgres-fts.md) |
| 15 | Implement pgvector semantic retrieval | todo | [15](15-vector-retrieval-pgvector.md) |
| 16 | Implement hybrid ranking, snippets, and confidence | todo | [16](16-hybrid-ranking-confidence-snippets.md) |
| 17 | Implement `search_docs` MCP tool | todo | [17](17-search-docs-tool.md) |
| 18 | Implement `get_doc_page` and docs resources | todo | [18](18-get-doc-page-and-doc-resources.md) |
| 19 | Migrate `search_bun_docs` to docs retrieval compatibility wrapper | todo | [19](19-search-bun-docs-compatibility.md) |
| 20 | Add refresh job queue, dedupe, and priority scoring | todo | [20](20-refresh-job-queue-and-priority.md) |
| 21 | Implement docs worker scheduled and on-demand refresh | todo | [21](21-docs-worker-scheduled-and-demand-refresh.md) |
| 22 | Implement stale content and tombstone policy | todo | [22](22-tombstone-stale-policy.md) |
| 23 | Add Docker and deployment configuration | todo | [23](23-docker-compose-deployment.md) |
| 24 | Add final QA, documentation, and traceability | todo | [24](24-final-qa-docs-traceability.md) |

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
