# Task 14 - Implement Postgres Full-Text Keyword Retrieval

## Goal

Add exact/keyword retrieval over stored docs chunks using Postgres full-text search and metadata filters.

## Motivation

Documentation search must handle exact API names, CLI flags, config options, package names, and error strings. Vector search alone is not reliable for these cases.

## Scope

- Implement keyword retrieval query path.
- Use indexed `tsvector` data or generated search vector.
- Filter by source ID.
- Bound result limits.
- Return chunk/page IDs, URL, heading path, title, scores, freshness metadata, and snippets.
- Add exact-token boosts for code-like terms.

## Out Of Scope

- No vector search.
- No hybrid merge.
- No MCP tools.

## Behavior Requirements

- `Bun.serve` exact query returns related chunk.
- `bun:test` exact query returns test docs chunk.
- `bun.lock` and CLI flag queries are not lost.
- Result limit defaults and maximums are enforced.
- Empty results are valid and explicit.

## Tests To Implement First

Add:

- `tests/integration/docs/retrieval/keyword-retrieval.test.ts`
  - exact API query finds matching chunk.
  - CLI flag/package-manager query finds matching chunk.
  - source filter excludes other sources.
  - limit is bounded.
  - empty result returns no fabricated content.
  - scores are stable enough for deterministic ordering.

Use seeded chunks through storage helpers. Do not fetch network.

## Validation

- Keyword retrieval tests.
- Storage tests.
- `bun run typecheck`
- `bun run check`

## Acceptance Criteria

- Exact docs lookup works without embeddings.
- Retrieval output has enough metadata for tool responses.
- Query path is safe, parameterized, and bounded.

## Commit Guidance

Commit keyword retrieval implementation and tests only.

Suggested message:

```text
feat: add Postgres keyword retrieval for docs chunks
```
