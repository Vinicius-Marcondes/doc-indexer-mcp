# 02 - Citations, Finding Cache, And Delta

Read this file only when working on citation de-duplication, finding-level cache, delta tokens, or source-backed change metadata.

## Task 3.1: Implement Citation Map Builder

Purpose: Replace repeated per-finding source URL arrays with top-level citation maps.

Implementation guidance:

- Create a module such as `src/recommendations/citations.ts`.
- Accept existing `SourceCitation` objects and local evidence references.
- Generate response-scoped citation IDs.
- Deduplicate by URL, source type, content hash, and title where appropriate.
- Provide helpers to map recommendation source URLs to citation IDs.
- Ensure local project evidence does not expose secret file contents.

Tests to implement first:

- `tests/unit/recommendations/citations.test.ts`
  - Duplicate Bun docs URLs produce one citation ID.
  - npm source and Bun docs source with different URLs produce different IDs.
  - Local project evidence maps to safe local citation entries.
  - Missing citation references are detected by envelope validation.

Acceptance criteria:

- V2 outputs reference citation IDs from findings, actions, examples, and warnings.
- Repeated source URL arrays are not emitted in V2 findings.
- Citation output remains auditable.

QA impact:

- Reduces payload size without weakening source-backed behavior.

## Task 3.2: Implement Finding-Level Cache

Purpose: Cache normalized findings by file/rule/source evidence instead of only storing full project analysis snapshots.

Implementation guidance:

- Add a SQLite-backed finding cache module such as `src/cache/finding-cache.ts`.
- Store:
  - `projectHash`
  - `scope`
  - `relativePath`
  - `fileHash`
  - `ruleId`
  - `fingerprint`
  - normalized finding JSON
  - source citation content hashes
  - generated timestamp
  - schema version
- Invalidate affected findings when file hash or source citation hash changes.
- Preserve existing source cache behavior.

Tests to implement first:

- `tests/unit/cache/finding-cache.test.ts`
  - Stores and retrieves a finding by project hash and fingerprint.
  - Reuses unchanged file/rule findings.
  - Invalidates when file hash changes.
  - Invalidates when schema version changes.
  - Invalidates source-backed finding when source content hash changes.

Acceptance criteria:

- Repeat tool calls can reuse unchanged normalized findings.
- Cache keys are deterministic.
- Stale findings are not returned as current without warnings.

QA impact:

- Reduces duplicate payload generation across repeated agent calls.

## Task 3.3: Implement Delta Token Behavior

Purpose: Let agents ask "what changed since my last call" without losing critical current risks.

Implementation guidance:

- Define delta token shape and storage policy.
- Prefer opaque tokens; do not expose raw cache keys if avoidable.
- Tokens may be process-local for V2 unless persistence is explicitly chosen.
- Include new, changed, resolved, and repeated finding IDs.
- If a token is invalid or expired, return a warning and a normal current response.
- Always include current error-severity findings even if repeated.

Tests to implement first:

- `tests/unit/cache/finding-cache.test.ts` or `tests/integration/tools/project-health.test.ts`
  - First call returns a `deltaToken`.
  - Second call with unchanged project returns repeated IDs and compact output.
  - Changed file produces changed or new finding IDs.
  - Resolved issue appears in resolved IDs.
  - Invalid token produces warning and current response.
  - Error findings are included even when repeated.

Acceptance criteria:

- Delta behavior is deterministic within the supported token lifetime.
- Agents can reduce repeated context without missing critical issues.
- Token failure is safe and explicit.

QA impact:

- Prevents repeated calls from flooding the agent with identical findings.

## Task 3.4: Add Source-Backed Change Metadata Support

Purpose: Surface what is new or changed only when official evidence supports it.

Implementation guidance:

- Use npm publish times for dependency metadata when relevant.
- Use official Bun release/changelog metadata only after Task 0.1 confirms source format.
- Add `sourceType: "bun-release"` if release sources are adopted.
- Populate `sinceDate`, `sinceVersion`, `breaking`, and `afterAgentTrainingCutoff` only from source-backed evidence.
- Omit unsupported fields rather than guessing.
- Return warnings when a caller asks for cutoff comparison but source dates are unavailable.

Tests to implement first:

- `tests/unit/recommendations/change-metadata.test.ts`
  - npm publish time can populate `sinceDate`.
  - Official release metadata can populate `sinceVersion` when fixture source includes it.
  - Missing source date omits `afterAgentTrainingCutoff`.
  - Cutoff comparison is true only when source date is later.
  - Breaking flag is omitted unless source metadata supports it.
- Source adapter tests if a Bun release adapter is added.

Acceptance criteria:

- Change metadata increases trust instead of creating false certainty.
- No V2 response claims recency from model memory.
- Official source citations are attached to change metadata.

QA impact:

- Helps agents correct stale training-data assumptions safely.
