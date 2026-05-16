# Task 11 - Add Embedding Provider Contract And Deterministic Fake Provider

## Goal

Define a provider-agnostic embedding interface and add a deterministic fake provider for offline tests.

## Motivation

Embeddings must default to OpenAI but remain replaceable. Tests must not call external APIs or rely on model output to verify ingestion and retrieval behavior.

## Scope

- Add `EmbeddingProvider` interface.
- Define batch embedding request/response contracts.
- Define provider metadata:
  - provider name.
  - model.
  - dimensions.
  - embedding version.
- Add deterministic fake provider.
- Add vector dimension validation helpers.

## Out Of Scope

- No OpenAI API implementation.
- No DB writes.
- No vector search.

## Architecture Requirements

- Keep provider code under `src/docs/embeddings`.
- Provider interface must be independent from Postgres.
- Fake provider output must be deterministic from text input.
- Provider errors must use structured errors or typed failure results.

## Tests To Implement First

Add:

- `tests/unit/docs/embeddings/provider-contract.test.ts`
  - fake provider returns configured dimensions.
  - same text returns same vector.
  - different text returns distinguishable vector.
  - batch order is preserved.
  - dimension mismatch helper rejects invalid vectors.
  - provider metadata includes version/model/provider.
  - provider failure shape is structured.

## Validation

- Embedding provider contract tests.
- `bun run typecheck`
- `bun run check`

## Acceptance Criteria

- Later ingestion can request embeddings without knowing provider implementation.
- Tests can use fake embeddings deterministically.
- Provider/model/dimension metadata is available for storage.

## Commit Guidance

Commit embedding contract, fake provider, and tests only.

Suggested message:

```text
feat: add pluggable embedding provider contract
```
