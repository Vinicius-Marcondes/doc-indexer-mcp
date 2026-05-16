# Task 18 - Implement `get_doc_page` And Docs Resources

## Goal

Expose stored documentation pages and chunks through a `get_doc_page` tool and read-only MCP resources.

## Motivation

Search returns compact snippets. Agents also need a controlled way to inspect the full cited page or a specific chunk without arbitrary URL access.

## Scope

- Add `get_doc_page` MCP tool.
- Add resources:
  - `docs://sources`
  - `docs://page/{sourceId}/{pageId}`
  - `docs://chunk/{sourceId}/{chunkId}`
- Validate source ID and URL/page/chunk identifiers.
- Retrieve stored pages/chunks from Postgres.
- Handle missing/stale pages with explicit metadata.
- Allow on-demand allowed-page fetch signal, but defer queueing to refresh tasks if not present.

## Out Of Scope

- No broad web fetch.
- No arbitrary URL proxy.
- No admin refresh tool.

## Behavior Requirements

- `get_doc_page` rejects disallowed URLs.
- Stored page returns title, URL, content, chunks, hashes, timestamps, freshness, and sources.
- Missing allowed page returns missing response or refresh signal without fabricating content.
- Resource templates cannot be used to fetch arbitrary URLs.
- `docs://sources` lists enabled source packs and counts.

## Tests To Implement First

Add:

- `tests/integration/tools/get-doc-page.test.ts`
  - stored page can be retrieved by allowed URL.
  - disallowed URL returns structured error.
  - missing allowed URL returns explicit missing/fetch signal.
  - stale page returns stale freshness.

Add:

- `tests/integration/resources/docs-resources.test.ts`
  - `docs://sources` lists Bun source.
  - page resource returns stored page.
  - chunk resource returns stored chunk.
  - invalid source/page/chunk returns structured error.
  - resource template manipulation cannot fetch arbitrary URL.

## Validation

- Page tool and resource tests.
- Remote registration tests.
- `bun run typecheck`
- `bun run check`

## Acceptance Criteria

- Agents can inspect cited pages and chunks safely.
- Resources are read-only and database-backed.
- Arbitrary URL/resource access is blocked.

## Commit Guidance

Commit page tool/resources and tests only.

Suggested message:

```text
feat: expose stored docs pages and chunks over MCP
```
