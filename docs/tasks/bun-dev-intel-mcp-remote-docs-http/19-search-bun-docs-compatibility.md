# Task 19 - Migrate `search_bun_docs` To Docs Retrieval Compatibility Wrapper

## Goal

Make `search_bun_docs` delegate to the new docs retrieval service with `sourceId: "bun"` while preserving compatibility for existing clients where practical.

## Motivation

The project should not maintain two independent Bun docs search implementations. The old tool should benefit from hybrid retrieval without creating drift.

## Scope

- Update `search_bun_docs` handler path to call the generic docs retrieval service.
- Map existing `topic` input to retrieval filters or metadata boosts where useful.
- Preserve current response fields where compatibility matters.
- Include richer retrieval/freshness metadata.
- Keep old source adapter tests only where they still cover lower-level fallback behavior, or update them intentionally.

## Out Of Scope

- No removal of `search_docs`.
- No project-analysis tool changes.
- No deprecated behavior that bypasses database retrieval unless explicitly preserved as fallback.

## Behavior Requirements

- `search_bun_docs` returns Bun docs results from indexed storage.
- It does not independently parse `llms-full.txt` in the tool path.
- Invalid topic still fails validation.
- Existing clients can still call the old tool name.
- Compatibility response includes citations and freshness.

## Tests To Implement First

Update/add:

- `tests/integration/tools/search-bun-docs.test.ts`
  - TypeScript query delegates to docs retrieval and returns Bun result.
  - topic boost affects ranking where deterministic.
  - invalid topic fails validation.
  - low-confidence result includes warning.
  - result includes hybrid retrieval metadata.

Add a regression test:

- `tests/integration/tools/search-docs-compatibility.test.ts`
  - `search_bun_docs` and `search_docs({ sourceId: "bun" })` use same underlying result path.

## Validation

- Bun docs search tests.
- Generic docs search tests.
- Existing e2e tests.
- `bun run typecheck`
- `bun run check`

## Acceptance Criteria

- The old Bun docs tool is a compatibility wrapper.
- Search quality improvements apply to both old and new tool names.
- No duplicate search implementation remains in public tool paths.

## Commit Guidance

Commit compatibility wrapper and tests only.

Suggested message:

```text
refactor: route Bun docs search through hybrid docs retrieval
```
