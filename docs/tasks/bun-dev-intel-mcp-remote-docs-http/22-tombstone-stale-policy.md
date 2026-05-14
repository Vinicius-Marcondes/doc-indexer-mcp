# Task 22 - Implement Stale Content And Tombstone Policy

## Goal

Define and implement how stale, missing, failed, and deleted documentation pages are represented and returned.

## Motivation

Remote agents need clear evidence quality. Stale content may still be useful with warnings, but deleted or repeatedly missing pages should not silently masquerade as valid current docs.

## Scope

- Add freshness calculation policy.
- Add stale response metadata for pages/chunks/search results.
- Add tombstone confirmation policy for repeated 404/410 responses.
- Add max stale age behavior if chosen by PRD/team.
- Ensure search and page tools surface stale/tombstone warnings.

## Out Of Scope

- No broad source discovery changes.
- No deletion of rows without tombstone metadata.
- No model-based freshness inference.

## Behavior Requirements

- Fresh pages are marked fresh before expiry.
- Expired pages are marked stale.
- Stale pages may still be returned with warning.
- Repeated confirmed 404/410 tombstones page.
- Tombstoned pages are excluded from normal search by default.
- Direct page lookup for tombstoned page returns tombstone metadata.
- Low retrieval score never tombstones content by itself.

## Tests To Implement First

Add:

- `tests/unit/docs/freshness-policy.test.ts`
  - fresh/stale/missing/refreshing states are computed.
  - max stale age behavior matches configured policy.

Add:

- `tests/integration/docs/refresh/tombstone-policy.test.ts`
  - first 404 records failure but does not tombstone if policy requires confirmation.
  - repeated 404/410 tombstones page.
  - tombstoned page excluded from search.
  - direct page lookup returns tombstone response.
  - low-confidence search does not tombstone anything.

## Validation

- Freshness/tombstone tests.
- Search/page tests.
- Worker tests.
- `bun run typecheck`
- `bun run check`

## Acceptance Criteria

- Freshness semantics are deterministic.
- Agents can distinguish stale evidence from deleted evidence.
- Content is not deleted or hidden without source-backed removal evidence.

## Commit Guidance

Commit freshness/tombstone policy and tests only.

Suggested message:

```text
feat: add docs freshness and tombstone policy
```
