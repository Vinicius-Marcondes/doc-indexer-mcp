# Task 10 - Implement Documentation Chunking And Hashing

## Goal

Split normalized documentation pages into stable, searchable chunks with heading paths, token estimates, and content hashes.

## Motivation

Good retrieval depends on chunks that are small enough to rank precisely but large enough to preserve context. Stable hashes prevent unnecessary re-embedding and make citations auditable.

## Scope

- Add chunking module under `src/docs/ingestion` or `src/docs/retrieval`.
- Preserve heading hierarchy as `headingPath`.
- Preserve code/API-heavy content.
- Estimate token length or character-based equivalent.
- Generate stable content hashes for pages and chunks.
- Support source-pack chunking defaults.

## Out Of Scope

- No database writes.
- No embeddings.
- No retrieval ranking.

## Behavior Requirements

- Chunking is deterministic.
- Chunk size respects configured max/min boundaries.
- Headings carry into child chunks.
- Code identifiers like `Bun.serve`, `bun:test`, and `bun.lock` are preserved.
- Re-running chunking on unchanged content yields identical hashes.

## Tests To Implement First

Add:

- `tests/unit/docs/ingestion/chunking.test.ts`
  - splits long docs into bounded chunks.
  - preserves heading paths.
  - preserves code blocks and API identifiers.
  - generates stable page and chunk hashes.
  - different content changes relevant hashes.
  - tiny pages still produce one valid chunk.
  - chunk order is stable.

## Validation

- Chunking tests.
- `bun run typecheck`
- `bun run check`

## Acceptance Criteria

- Later ingestion can store stable chunks without redoing chunk logic.
- Chunk metadata is sufficient for search results and docs resources.
- Hashes can be used to avoid duplicate embeddings.

## Commit Guidance

Commit chunking/hashing implementation and tests only.

Suggested message:

```text
feat: add stable docs chunking and content hashing
```
