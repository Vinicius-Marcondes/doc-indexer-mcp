# 01 - Contracts, Security, And Cache

Read this file only when working on shared data contracts, structured errors, filesystem safety, ignore policy, or SQLite cache behavior.

## Task 2.1: Define Core Result Types

Purpose: Create shared TypeScript types for source citations, recommendations, cache metadata, confidence, warnings, and tool responses.

Implementation guidance:

- Define source citation, recommendation, cache metadata, warning, confidence, and base response types.
- Keep types close to the PRD data contracts.
- Make all tool outputs include `generatedAt`, `cacheStatus`, `sources`, `confidence`, `recommendations`, and `warnings`.
- Use discriminated unions where they improve safety.
- Avoid stringly typed status values outside centralized types.

Tests to implement first:

- `tests/unit/contracts.test.ts`
  - Validate allowed `cacheStatus` values.
  - Validate allowed `confidence` values.
  - Validate required fields for source citations.
  - Validate required fields for recommendations.

Acceptance criteria:

- Tool-specific outputs can extend a shared base response.
- TypeScript rejects invalid status/confidence values.
- Runtime schema tests reject malformed response-like objects where schemas exist.

QA impact:

- Keeps all tools consistent.
- Makes recommendation quality auditable because every output has evidence and confidence fields.

## Task 2.2: Define Structured Error Responses

Purpose: Ensure failures are explicit and do not produce fabricated guidance.

Implementation guidance:

- Add typed errors for invalid input, unsafe path, disallowed source, fetch failure, parse failure, cache miss, and unsupported project.
- Include stable `code`, human-readable `message`, and optional `details`.
- Convert thrown internal errors into structured MCP-safe responses.
- Do not include secret file contents or raw local path internals beyond what the user provided.

Tests to implement first:

- `tests/unit/errors.test.ts`
  - Invalid input returns a schema validation error.
  - Disallowed source returns a disallowed-source error.
  - Fetch failure without cache returns a no-evidence error.
  - Internal errors do not leak stack traces by default.

Acceptance criteria:

- All known failure modes produce structured errors.
- No recommendation is returned when evidence fetch and cache fallback both fail.
- Errors are stable enough for agents to branch on `code`.

QA impact:

- Prevents silent failure and hallucinated recommendations.
- Makes MCP client behavior predictable under network or parsing problems.

## Task 3.1: Implement Safe Project Path Handling

Purpose: Prevent path traversal and restrict analysis to the requested project root.

Implementation guidance:

- Resolve `projectPath` to an absolute path.
- Confirm it exists and is a directory.
- Treat the resolved project root as the maximum traversal boundary.
- Reject paths that resolve outside the intended root during file discovery.
- Normalize paths before comparisons.
- Do not follow symlinks outside the project root.

Tests to implement first:

- `tests/unit/security/path-boundary.test.ts`
  - Accepts a valid fixture project path.
  - Rejects missing paths.
  - Rejects file paths when a directory is required.
  - Rejects traversal attempts.
  - Rejects symlinks that escape the fixture root if symlink support is present.

Acceptance criteria:

- File discovery cannot read outside the project root.
- Tool input validation catches unsafe paths before analyzers run.
- Error responses do not expose unnecessary filesystem details.

QA impact:

- Protects the user's machine from accidental over-reading.
- Creates a secure foundation for local analysis.

## Task 3.2: Implement Ignore Policy

Purpose: Guarantee the server never reads forbidden or irrelevant directories/files.

Implementation guidance:

- Centralize ignored directory and file patterns.
- Required ignored directories: `node_modules`, `.git`, `dist`, `build`, `.cache`, `coverage`, `.turbo`, `.next`, `.expo`.
- Required ignored secret files: `.env`, `.env.local`, `.env.production`, private keys, credential files.
- Apply the ignore policy before opening files.
- Track skipped paths as counts or redacted path labels, never as file contents.

Tests to implement first:

- `tests/unit/security/ignore-policy.test.ts`
  - `node_modules` is skipped.
  - Build/cache/coverage directories are skipped.
  - `.env` files are skipped.
  - Binary-looking files are skipped.
  - Skipped files are not opened by the file reader.

Acceptance criteria:

- No analyzer test opens ignored files.
- Ignore rules are shared by file discovery and AST analysis.
- A regression test fails if `node_modules` is ever read.

QA impact:

- Enforces the user's hard requirement.
- Reduces performance cost and prevents leaking secrets into MCP output.

## Task 4.1: Implement Cache Schema And Store

Purpose: Persist official docs, npm metadata, and project analysis metadata with timestamps and hashes.

Implementation guidance:

- Use SQLite.
- Store `key`, `sourceType`, `sourceUrl`, `content`, `contentHash`, `fetchedAt`, `expiresAt`, `status`, and optional `errorSummary`.
- Provide cache APIs for get, set, stale lookup, delete, and clear test cache.
- Hash normalized content, not object identity.
- Keep test cache files isolated under temporary test directories.

Tests to implement first:

- `tests/unit/cache/sqlite-cache.test.ts`
  - Creates cache schema.
  - Stores and retrieves content.
  - Computes content hash.
  - Marks entries fresh before TTL.
  - Marks entries stale after TTL.
  - Separates entries by key and source type.

Acceptance criteria:

- Cache initializes repeatedly without corrupting data.
- Cache metadata matches PRD fields.
- Tests do not write cache files into production locations.

QA impact:

- Makes live data repeatable and inspectable.
- Enables offline deterministic testing after mocked fetches.

## Task 4.2: Implement Cache Fallback Policy

Purpose: Define reliable behavior when live official sources are unavailable.

Implementation guidance:

- Fresh cache should be used when live fetch fails.
- Stale cache may be used with warning and reduced confidence.
- No cache must produce structured no-evidence error.
- Include `cacheStatus`, `fetchedAt`, and warning details in responses.
- Do not silently promote stale cache to fresh.

Tests to implement first:

- `tests/unit/cache/fallback-policy.test.ts`
  - Live fetch success stores fresh cache.
  - Live fetch failure plus fresh cache returns fresh cache with warning.
  - Live fetch failure plus stale cache returns stale cache and lower confidence.
  - Live fetch failure plus no cache returns structured error.

Acceptance criteria:

- All source adapters share the same fallback policy.
- Confidence is lowered when stale data is used.
- Agents can see whether guidance came from live or cached evidence.

QA impact:

- Maintains usefulness during network failures without pretending data is current.
- Prevents recommendations based on invisible stale state.
