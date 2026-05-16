# Task 09 - Implement Bun Docs Discovery, Fetch, And Normalization

## Goal

Implement deterministic Bun docs discovery and page normalization using the Bun source pack.

## Motivation

The docs index must be populated from official sources before search quality can improve. Fetching and normalization should be deterministic, source-backed, and independent from embedding or ranking.

## Scope

- Fetch Bun docs index from official source.
- Parse page URLs and basic titles.
- Fetch individual allowed Bun docs pages.
- Normalize page content into clean text/markdown suitable for chunking.
- Preserve canonical URL, title, fetched timestamp, HTTP status, and content hash.
- Handle stale/fetch failures as structured results.

## Out Of Scope

- No chunk storage.
- No embeddings.
- No hybrid retrieval.
- No worker scheduling.

## Architecture Requirements

- Reuse existing fetch-client/allowlist concepts where practical, but do not weaken policy.
- Keep source fetch adapters injectable for tests.
- Do not read local project files.
- Do not use browser automation for baseline Bun docs ingestion.

## Tests To Implement First

Add:

- `tests/unit/docs/sources/bun-docs-normalizer.test.ts`
  - markdown/HTML content normalizes consistently.
  - code blocks are preserved enough for search.
  - heading text is preserved.
  - navigation/boilerplate is removed when present.

Add:

- `tests/integration/docs/sources/bun-docs-discovery.test.ts`
  - mocked `llms.txt` discovers expected pages.
  - disallowed URL in index is ignored or rejected with warning.
  - mocked page fetch returns normalized page metadata.
  - network failure returns structured error.
  - redirect to disallowed host is rejected.

## Validation

- Bun docs source tests.
- Existing Bun docs adapter tests.
- `bun run typecheck`
- `bun run check`

## Acceptance Criteria

- Bun docs pages can be discovered and normalized from mocked official sources.
- Outputs are deterministic and citation-ready.
- Fetch failures do not fabricate content.

## Commit Guidance

Commit Bun docs discovery/fetch/normalization modules and tests only.

Suggested message:

```text
feat: discover and normalize official Bun docs
```
