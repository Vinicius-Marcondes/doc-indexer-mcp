# Task 08 - Define Source-Pack Contract And Bun Allowlist

## Goal

Create the source-pack abstraction and implement the Bun source pack with strict official URL allowlisting.

## Motivation

The PRD requires Bun first, with future docs domains added cleanly. Source-specific policy must be isolated so TypeScript, MCP, SAP Commerce, or internal docs can be added later without rewriting retrieval internals.

## Scope

- Define `DocsSourcePack` contract.
- Implement Bun source pack metadata.
- Implement Bun docs URL allowlist for:
  - `https://bun.com/docs/llms.txt`
  - `https://bun.com/docs/llms-full.txt`
  - pages under `https://bun.com/docs/`
- Reject non-HTTPS and hostname tricks.
- Revalidate redirects against allowlist.
- Add source registry for enabled packs.

## Out Of Scope

- No page fetching yet except URL validation helper tests.
- No chunking.
- No embeddings.

## Architecture Requirements

- Keep source-pack code under `src/docs/sources`.
- Do not mix source-pack policy with transport middleware.
- Source pack must expose enough metadata for `docs://sources` later.
- Allowlist checks must be pure/testable where possible.

## Tests To Implement First

Add:

- `tests/unit/docs/sources/bun-source-pack.test.ts`
  - Bun source pack has stable `sourceId`.
  - official index URLs are allowed.
  - official docs pages are allowed.
  - `http://bun.com/docs/...` is rejected.
  - `bun.com.evil.test` is rejected.
  - encoded path traversal is rejected.
  - redirect target is revalidated and disallowed if outside policy.
  - unknown source ID fails source registry lookup.

## Validation

- Source-pack tests.
- Existing source allowlist tests.
- `bun run typecheck`
- `bun run check`

## Acceptance Criteria

- Bun docs source policy is explicit and covered by tests.
- Future source packs have a clear contract.
- No remote docs code can fetch arbitrary URLs through the source-pack layer.

## Commit Guidance

Commit source-pack contract, Bun source pack, and tests only.

Suggested message:

```text
feat: add Bun docs source pack and allowlist
```
