# Task 09: Extract Docs-Domain Package

## Goal

Move remote-docs business logic into `packages/docs-domain` so MCP and admin share one implementation.

## Scope

- Create `packages/docs-domain`.
- Move source packs, source policy, discovery, normalization, chunking, embeddings, retrieval, refresh, ingestion, and transport-neutral docs services.
- Update MCP and admin server imports.
- Keep compatibility re-exports for one phase if required.

## Out Of Scope

- Do not change retrieval ranking behavior.
- Do not change source allowlist.
- Do not change worker scheduling semantics.
- Do not move app entrypoints.

## Required Tests

```text
bun test tests/unit/docs tests/integration/docs tests/integration/tools tests/integration/resources
bun run typecheck
```

## Acceptance Criteria

- `packages/docs-domain` owns shared docs behavior.
- No copied docs-domain source exists under admin app paths.
- Existing docs tests pass.
- Admin search and MCP search use the same domain implementation.

