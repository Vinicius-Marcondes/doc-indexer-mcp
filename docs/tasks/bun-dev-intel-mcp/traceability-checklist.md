# Bun Dev Intelligence MCP Traceability Checklist

Updated: 2026-05-12

## Product Surface

- [x] `analyze_bun_project`
  - Implementation: `src/tools/analyze-bun-project.ts`
  - Tests: `tests/integration/tools/analyze-bun-project.test.ts`, `tests/e2e/bun-dev-intel-flow.test.ts`
- [x] `search_bun_docs`
  - Implementation: `src/tools/search-bun-docs.ts`
  - Tests: `tests/integration/tools/search-bun-docs.test.ts`, `tests/e2e/bun-dev-intel-flow.test.ts`
- [x] `get_bun_best_practices`
  - Implementation: `src/tools/get-bun-best-practices.ts`
  - Tests: `tests/integration/tools/get-bun-best-practices.test.ts`
- [x] `plan_bun_dependency`
  - Implementation: `src/tools/plan-bun-dependency.ts`
  - Tests: `tests/integration/tools/plan-bun-dependency.test.ts`, `tests/e2e/bun-dev-intel-flow.test.ts`
- [x] `review_bun_project`
  - Implementation: `src/tools/review-bun-project.ts`
  - Tests: `tests/integration/tools/review-bun-project.test.ts`, `tests/e2e/bun-dev-intel-flow.test.ts`
- [x] MCP server registration for all tools and resources
  - Implementation: `src/server.ts`
  - Tests: `tests/integration/mcp/server-registration.test.ts`
- [x] Stdio-only startup
  - Implementation: `src/stdio.ts`
  - Tests: `tests/integration/mcp/stdio-entrypoint.test.ts`
  - Note: `@modelcontextprotocol/server@2.0.0-alpha.2` does not expose the documented `./stdio` export in npm metadata, so `src/stdio.ts` implements a local stdio transport compatible with the SDK transport shape.

## MCP Resources

- [x] `bun-docs://index`
  - Implementation: `src/resources/bun-docs-index-resource.ts`
  - Tests: `tests/integration/resources/bun-docs-index-resource.test.ts`
- [x] `bun-docs://page/{slug}`
  - Implementation: `src/resources/bun-docs-page-resource.ts`, `src/sources/bun-docs-page.ts`
  - Tests: `tests/integration/resources/bun-docs-page-resource.test.ts`
- [x] `bun-project://analysis/{projectHash}`
  - Implementation: `src/resources/bun-project-analysis-resource.ts`, `src/resources/project-analysis-store.ts`
  - Tests: `tests/integration/resources/bun-project-analysis-resource.test.ts`

## Source Policy And Cache

- [x] Official source allowlist
  - Implementation: `src/sources/allowlist.ts`
  - Tests: `tests/unit/sources/allowlist.test.ts`
- [x] Fetch client enforces allowlist before network calls
  - Implementation: `src/sources/fetch-client.ts`
  - Tests: `tests/unit/sources/fetch-client.test.ts`
- [x] Bun docs index adapter
  - Implementation: `src/sources/bun-docs-index.ts`
  - Tests: `tests/unit/sources/bun-docs-index.test.ts`
- [x] Bun docs content search adapter
  - Implementation: `src/sources/bun-docs-search.ts`
  - Tests: `tests/unit/sources/bun-docs-search.test.ts`
- [x] npm registry metadata adapter
  - Implementation: `src/sources/npm-registry.ts`
  - Tests: `tests/unit/sources/npm-registry.test.ts`
- [x] SQLite cache store and content hashes
  - Implementation: `src/cache/sqlite-cache.ts`
  - Tests: `tests/unit/cache/sqlite-cache.test.ts`
- [x] Fresh/stale cache fallback policy
  - Implementation: `src/cache/fallback-policy.ts`
  - Tests: `tests/unit/cache/fallback-policy.test.ts`
- [x] Default cache outside analyzed projects
  - Implementation: `src/server.ts`
  - Documentation: `README.md`

## Project Analysis And Safety

- [x] Safe project path handling
  - Implementation: `src/security/project-paths.ts`
  - Tests: `tests/unit/security/path-boundary.test.ts`
- [x] Ignore policy for `node_modules`, build output, binary files, and secret-like files
  - Implementation: `src/security/ignore-policy.ts`
  - Tests: `tests/unit/security/ignore-policy.test.ts`, `tests/unit/analyzers/source-discovery.test.ts`
- [x] `package.json` parsing
  - Implementation: `src/analyzers/package-json.ts`
  - Tests: `tests/unit/analyzers/package-json.test.ts`
- [x] Lockfile and package manager signal detection
  - Implementation: `src/analyzers/lockfiles.ts`
  - Tests: `tests/unit/analyzers/lockfiles.test.ts`
- [x] `tsconfig.json` parsing
  - Implementation: `src/analyzers/tsconfig.ts`
  - Tests: `tests/unit/analyzers/tsconfig.test.ts`
- [x] `bunfig.toml` parsing without leaking secrets
  - Implementation: `src/analyzers/bunfig.ts`
  - Tests: `tests/unit/analyzers/bunfig.test.ts`
- [x] Source discovery without traversing ignored paths
  - Implementation: `src/analyzers/source-discovery.ts`
  - Tests: `tests/unit/analyzers/source-discovery.test.ts`
- [x] TypeScript AST import analysis
  - Implementation: `src/analyzers/ast-imports.ts`
  - Tests: `tests/unit/analyzers/ast-imports.test.ts`
- [x] Bun global API detection
  - Implementation: `src/analyzers/ast-bun-globals.ts`
  - Tests: `tests/unit/analyzers/ast-bun-globals.test.ts`
- [x] Test and `bun:test` detection
  - Implementation: `src/analyzers/test-analysis.ts`
  - Tests: `tests/unit/analyzers/test-analysis.test.ts`

## Recommendations And Evidence

- [x] Recommendation rules include evidence and sources
  - Implementation: `src/recommendations/rules.ts`
  - Tests: `tests/unit/recommendations/rules.test.ts`
- [x] Dependency plan recommendations use Bun commands and npm metadata
  - Implementation: `src/recommendations/dependency-plan.ts`
  - Tests: `tests/unit/recommendations/dependency-plan.test.ts`
- [x] Confidence calculation reflects evidence quality and cache state
  - Implementation: `src/recommendations/confidence.ts`
  - Tests: `tests/unit/recommendations/confidence.test.ts`
- [x] Dependency latest compatibility warning appears in review packets
  - Implementation: `src/tools/review-bun-project.ts`
  - Tests: `tests/e2e/bun-dev-intel-flow.test.ts`

## Test And Handoff Gates

- [x] Deterministic offline default test suite
  - Command: `bun test`
  - Coverage: `tests/unit`, `tests/integration`, `tests/e2e`
- [x] TypeScript gate
  - Command: `bun run typecheck`
  - Script: `package.json`
- [x] Combined quality gate
  - Command: `bun run check`
  - Script: `package.json`
- [x] Optional live tests are opt-in
  - Command: `LIVE_DOCS=1 bun test tests/live`
  - Tests: `tests/live/bun-docs.live.test.ts`, `tests/live/npm-registry.live.test.ts`
- [x] Usage documentation
  - Documentation: `README.md`
- [x] Source revalidation notes
  - Documentation: `docs/tasks/bun-dev-intel-mcp/source-revalidation.md`
