# Task 15 - Implement pgvector Semantic Retrieval

## Goal

Add semantic retrieval over stored docs embeddings using pgvector.

## Motivation

Agents often ask natural-language questions that do not contain exact documentation terms. Semantic retrieval improves recall for those cases.

## Scope

- Generate query embeddings through injected provider.
- Query pgvector embeddings for nearest chunks.
- Filter by source ID and embedding provider/model/version.
- Return chunk/page metadata and vector scores.
- Bound result limits.
- Handle missing embeddings gracefully.

## Out Of Scope

- No hybrid merge.
- No MCP tools.
- No ingestion changes unless a small storage helper is missing.

## Behavior Requirements

- Semantic query finds relevant seeded docs when exact terms differ.
- Query embedding is generated once per search request.
- Provider errors return structured failures.
- Vector dimension mismatch is rejected before query where possible.
- Missing embeddings return empty semantic results, not fabricated results.

## Tests To Implement First

Add:

- `tests/integration/docs/retrieval/vector-retrieval.test.ts`
  - semantic query returns nearest chunk using deterministic fake vectors.
  - source filter is honored.
  - provider/model/version filter is honored.
  - missing embeddings returns empty result.
  - provider failure surfaces structured error.
  - limit is bounded.

## Validation

- Vector retrieval tests.
- Embedding provider tests.
- Storage tests.
- `bun run typecheck`
- `bun run check`

## Acceptance Criteria

- Semantic retrieval works against pgvector.
- Provider/model/version compatibility is enforced.
- Search remains bounded and deterministic in tests.

## Commit Guidance

Commit vector retrieval implementation and tests only.

Suggested message:

```text
feat: add pgvector semantic retrieval for docs chunks
```
