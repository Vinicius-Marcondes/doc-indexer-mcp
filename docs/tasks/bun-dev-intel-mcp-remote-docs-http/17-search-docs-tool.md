# Task 17 - Implement `search_docs` MCP Tool

## Goal

Expose hybrid docs retrieval through a generic `search_docs` MCP tool on the remote docs server.

## Motivation

Remote agents need one stable MCP tool for documentation search that can grow beyond Bun without new transport or retrieval architecture.

## Scope

- Add `search_docs` input schema.
- Validate:
  - `query`
  - `sourceId`
  - `limit`
  - `mode`
  - `forceRefresh`
- Call hybrid retrieval service.
- Return compact results with citations, freshness, confidence, retrieval metadata, warnings, and refresh signal fields.
- Register tool only in remote docs capability set.

## Out Of Scope

- No actual refresh job enqueueing yet unless Task 20 is already complete.
- No `search_bun_docs` compatibility changes.
- No page retrieval tool.

## Behavior Requirements

- Defaults source to `bun`.
- Defaults mode to `hybrid`.
- Defaults limit to configured default.
- Enforces configured max limit.
- Invalid source fails validation.
- Tool responses include citation URLs for every result.
- Tool never exposes project-analysis behavior.

## Tests To Implement First

Add:

- `tests/integration/tools/search-docs.test.ts`
  - valid query returns hybrid docs results.
  - keyword mode avoids embedding provider.
  - invalid mode fails validation.
  - invalid source fails validation.
  - limit above max is rejected or clamped according to config.
  - empty result includes warning and low confidence.
  - every result has citation metadata.

Update remote registration tests:

- remote docs server includes `search_docs`.
- local stdio behavior remains unchanged.

## Validation

- `search_docs` tool tests.
- Remote MCP registration tests.
- `bun run typecheck`
- `bun run check`

## Acceptance Criteria

- `search_docs` is the primary remote docs search tool.
- Tool output is source-backed and compact.
- Remote-only registration is enforced.

## Commit Guidance

Commit `search_docs` tool and tests only.

Suggested message:

```text
feat: expose hybrid documentation search over MCP
```
