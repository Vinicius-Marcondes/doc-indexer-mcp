# 02 - Official Source Adapters

Read this file only when working on allowlisted network access, Bun docs, npm registry metadata, or dependency planning helpers.

## Task 5.1: Implement Source Allowlist

Purpose: Restrict network access to official sources approved by the PRD.

Implementation guidance:

- Centralize allowed hostnames and URL prefixes.
- Allowed hosts: `bun.com`, `registry.npmjs.org`, `modelcontextprotocol.io`, `github.com`, and `www.typescriptlang.org`.
- Reject non-HTTPS URLs except local test mocks.
- Reject URLs whose host matches by suffix tricks or encoded path tricks.
- Make allowlist checks mandatory before fetch.

Tests to implement first:

- `tests/unit/sources/allowlist.test.ts`
  - Allows Bun docs URLs.
  - Allows npm registry package URLs.
  - Allows MCP docs URLs.
  - Allows TypeScript docs URLs.
  - Rejects arbitrary domains.
  - Rejects misleading hostnames.
  - Rejects non-HTTPS external URLs.

Acceptance criteria:

- No source adapter can bypass the allowlist.
- Disallowed URLs fail before network fetch.
- Tests cover common URL parsing bypass attempts.

QA impact:

- Keeps recommendations trustworthy and source-scoped.
- Reduces attack surface from arbitrary remote fetches.

## Task 5.2: Implement Fetch Client Abstraction

Purpose: Make external fetches testable, cached, and policy-controlled.

Implementation guidance:

- Wrap global `fetch` behind a small interface.
- Enforce allowlist inside the wrapper.
- Add timeout handling.
- Normalize HTTP errors into structured errors.
- Allow dependency injection for mocked network tests.
- Capture response URL, status, fetched timestamp, and body hash.

Tests to implement first:

- `tests/unit/sources/fetch-client.test.ts`
  - Calls mocked fetch for allowed URLs.
  - Does not call fetch for disallowed URLs.
  - Converts non-2xx responses into structured errors.
  - Handles timeout or abort.
  - Returns metadata needed by the cache.

Acceptance criteria:

- Source adapters do not call global `fetch` directly.
- Network behavior is deterministic under tests.
- Fetch metadata can be passed into source citations.

QA impact:

- Makes live-source behavior testable without real network.
- Centralizes security and error handling.

## Task 6.1: Parse Bun Docs Index

Purpose: Discover official Bun documentation pages from the docs index.

Implementation guidance:

- Fetch `https://bun.com/docs/llms.txt`.
- Parse page titles and URLs where available.
- Cache parsed index and raw content.
- Provide a method to list pages by topic.
- Use cache fallback policy if `llms.txt` is unavailable.

Tests to implement first:

- `tests/unit/sources/bun-docs-index.test.ts`
  - Parses a mocked `llms.txt`.
  - Extracts titles and URLs.
  - Stores cache metadata.
  - Falls back to cached index on fetch failure.
  - Returns no fabricated pages when no evidence exists.

Acceptance criteria:

- Bun docs pages can be discovered without broad web search.
- Returned index entries include source URL and fetched timestamp.
- Parser tolerates minor docs-index formatting changes.

QA impact:

- Gives docs search an authoritative page inventory.
- Keeps search constrained to official Bun docs.

## Task 6.2: Parse And Search Bun Docs Content

Purpose: Return relevant official Bun snippets for agent questions.

Implementation guidance:

- Prefer `llms-full.txt` for broad docs search when available.
- Support individual page fetches for targeted topics.
- Normalize Markdown/text/HTML into searchable text.
- Implement deterministic ranking first: title match, heading match, and term frequency.
- Return short snippets with source URLs.
- Avoid excessive quoting from docs in output.

Tests to implement first:

- `tests/unit/sources/bun-docs-search.test.ts`
  - Finds TypeScript guidance for a TypeScript query.
  - Finds lockfile guidance for a lockfile query.
  - Finds test runner guidance for a test query.
  - Ranks title/heading matches above weak body matches.
  - Returns source citations and fetched timestamps.
  - Returns empty results with warning when no match exists.

Acceptance criteria:

- `search_bun_docs` can answer core PRD topics from official docs.
- Snippets are concise and cited.
- Search does not query the open web.

QA impact:

- Provides evidence for recommendations.
- Makes agent guidance inspectable instead of memory-based.

## Task 7.1: Fetch Package Metadata

Purpose: Read current npm package metadata for dependency planning.

Implementation guidance:

- Fetch package metadata from `https://registry.npmjs.org/{packageName}`.
- Support scoped packages through correct URL encoding.
- Extract dist-tags, latest version, versions map, deprecation messages, peer dependencies, engines, and publish times.
- Cache metadata with a 1-hour default TTL.
- Use structured errors for missing packages and malformed metadata.

Tests to implement first:

- `tests/unit/sources/npm-registry.test.ts`
  - Parses unscoped package metadata.
  - Parses scoped package metadata.
  - Extracts `dist-tags.latest`.
  - Extracts peer dependencies.
  - Extracts engines.
  - Detects deprecated package versions.
  - Handles 404 without fabricated package data.
  - Uses stale cache on network failure.

Acceptance criteria:

- Dependency planning can use package metadata without installing packages.
- Output includes npm registry source citations.
- Missing packages produce useful errors.

QA impact:

- Reduces dependency-version guesswork.
- Catches peer dependency and deprecation risks before edits.

## Task 7.2: Resolve Basic Dependency Recommendations

Purpose: Convert package metadata and project context into Bun install guidance.

Implementation guidance:

- Recommend `bun add <package>` for runtime dependencies.
- Recommend `bun add -d <package>` for development dependencies.
- Include requested ranges when provided by the user.
- Otherwise prefer latest stable dist-tag unless peer/engine/project constraints indicate a warning.
- Do not claim compatibility beyond available metadata.
- Do not mutate `package.json` or lockfiles.

Tests to implement first:

- `tests/unit/recommendations/dependency-plan.test.ts`
  - Runtime dependency returns `bun add`.
  - Dev dependency returns `bun add -d`.
  - Requested version range is preserved.
  - Deprecation warning is included.
  - Peer dependency warning is included.
  - Engine warning is included.
  - npm/yarn/pnpm commands are not recommended for Bun-first projects.

Acceptance criteria:

- Install commands are Bun-native.
- Warnings are evidence-backed.
- Response makes clear the MCP server did not install anything.

QA impact:

- Improves dependency safety while preserving agent/user control over execution.
- Prevents accidental package-manager drift.
