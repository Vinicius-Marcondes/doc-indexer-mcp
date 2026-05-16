# Task 24 - Add Final QA, Documentation, And Traceability

## Goal

Complete the implementation handoff with usage docs, quality gates, traceability, and end-to-end coverage.

## Motivation

The feature is only useful if future agents and developers can verify it, deploy it, and trace PRD requirements to code/tests.

## Scope

- Update README or dedicated docs with:
  - remote HTTP server usage.
  - bearer token configuration.
  - Docker/compose usage.
  - local vs remote capability split.
  - docs worker usage.
  - refresh behavior.
  - embedding provider config.
  - source policy.
  - quality commands.
- Add PRD traceability checklist mapping requirements to files/tests.
- Add deterministic e2e flow for remote docs:
  - ingest mocked Bun docs.
  - search docs over remote capability path.
  - retrieve cited page/chunk.
  - enqueue refresh for stale/low-confidence case.
- Run final gates.

## Out Of Scope

- No new product behavior except small fixes required by final tests.
- No additional source packs.
- No broad refactors.

## Tests To Implement First

Add:

- `tests/e2e/remote-docs-http-flow.test.ts`
  - authenticated remote MCP docs flow works with mocked sources and fake embeddings.
  - unauthenticated flow is rejected.
  - `search_docs` returns cited hybrid result.
  - `get_doc_page` returns cited stored page.
  - stale result enqueues refresh without blocking.
  - remote server does not expose local project-analysis tools.

Add traceability docs:

- `docs/tasks/bun-dev-intel-mcp-remote-docs-http/traceability-checklist.md`
  - PRD requirement.
  - implementation file(s).
  - test file(s).
  - status.

## Validation

- `bun test`
- `bun run typecheck`
- `bun run check`
- Optional live/manual deployment notes if Docker smoke was run.

## Acceptance Criteria

- Documentation explains how to run and deploy the remote docs service.
- Traceability checklist covers major PRD requirements.
- E2E flow proves the feature works as a product, not only as modules.
- Existing stdio/local behavior still passes.
- Final quality gates pass.

## Commit Guidance

Commit final docs, traceability, e2e tests, and small QA fixes only.

Suggested message:

```text
docs: add remote docs HTTP QA handoff and traceability
```
