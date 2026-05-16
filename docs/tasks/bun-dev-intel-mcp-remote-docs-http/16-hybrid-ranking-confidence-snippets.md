# Task 16 - Implement Hybrid Ranking, Snippets, And Confidence

## Goal

Merge keyword and semantic retrieval into one ranked result set with snippets, confidence, freshness, and warnings.

## Motivation

The PRD calls for hybrid search because exact and semantic retrieval solve different problems. Agents need one compact result list with clear evidence quality.

## Scope

- Add hybrid retrieval service.
- Support modes:
  - `keyword`
  - `semantic`
  - `hybrid`
- Merge duplicate chunks.
- Protect exact matches from being buried by vector-only results.
- Compute combined score and per-source scores.
- Generate snippets around matched text where possible.
- Compute confidence based on result quality, freshness, and failures.
- Record retrieval telemetry with hashed query.

## Out Of Scope

- No MCP tool handler yet.
- No refresh queueing yet except returning low-confidence signal for later tasks.

## Behavior Requirements

- Hybrid mode uses both retrieval paths.
- Keyword mode does not call embedding provider.
- Semantic mode can operate without keyword results.
- Duplicate chunks are merged.
- Exact API matches rank highly.
- Stale results lower confidence.
- Empty results produce warning and low confidence.

## Tests To Implement First

Add:

- `tests/integration/docs/retrieval/hybrid-retrieval.test.ts`
  - hybrid merges keyword and semantic results.
  - duplicate chunks are returned once.
  - exact `Bun.serve` match outranks semantically similar weak match.
  - keyword mode does not call embedding provider.
  - stale page lowers confidence.
  - empty result returns low confidence and warning.
  - retrieval event stores query hash, not raw query.

## Validation

- Hybrid retrieval tests.
- Keyword retrieval tests.
- Vector retrieval tests.
- `bun run typecheck`
- `bun run check`

## Acceptance Criteria

- Hybrid retrieval is the central search path for future tools.
- Result format matches PRD retrieval contract.
- Confidence and freshness are explicit.
- Query telemetry avoids raw query storage by default.

## Commit Guidance

Commit hybrid retrieval/ranking and tests only.

Suggested message:

```text
feat: combine keyword and vector docs retrieval
```
