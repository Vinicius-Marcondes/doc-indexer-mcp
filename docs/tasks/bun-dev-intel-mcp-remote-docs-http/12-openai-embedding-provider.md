# Task 12 - Add OpenAI Embedding Provider

## Goal

Implement the default OpenAI embedding provider behind the provider contract from Task 11.

## Motivation

The hosted docs service needs high-quality semantic retrieval by default, while still allowing future provider replacement.

## Scope

- Add OpenAI embedding provider.
- Read model/API key from validated config.
- Batch texts according to provider limits.
- Return provider/model/dimensions/version metadata.
- Handle API errors and rate limits as structured failures.
- Keep tests mocked and offline.

## Out Of Scope

- No live OpenAI tests by default.
- No DB writes.
- No retrieval.

## Security Requirements

- Never log `OPENAI_API_KEY`.
- Do not include raw provider response bodies in structured errors if they may contain sensitive data.
- Keep live tests opt-in only if added later.

## Tests To Implement First

Add:

- `tests/unit/docs/embeddings/openai-provider.test.ts`
  - sends expected request body to mocked fetch.
  - parses embedding response.
  - preserves input order.
  - handles rate-limit response with retryable structured error.
  - handles invalid response shape.
  - redacts API key from errors.
  - uses configured model.

## Validation

- OpenAI provider tests.
- Config tests.
- `bun run typecheck`
- `bun run check`

## Acceptance Criteria

- OpenAI is the default embedding provider option.
- All tests remain offline.
- Provider can be swapped without retrieval/storage changes.

## Commit Guidance

Commit OpenAI provider and mocked tests only.

Suggested message:

```text
feat: add OpenAI embedding provider for docs search
```
