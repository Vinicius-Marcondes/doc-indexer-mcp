# Bun Dev Intel Fixture Projects

These fixtures are intentionally small, offline, and not installed. They support analyzer, recommendation, and tool-flow tests.

| Fixture | Purpose |
| --- | --- |
| minimal-bun-ts | Bun-first TypeScript project with current lockfile and Bun types. |
| missing-bun-types | Uses Bun APIs without `@types/bun` or `types: ["bun"]`. |
| legacy-lockb | Contains legacy `bun.lockb` presence for lockfile warnings. |
| mixed-lockfiles | Contains Bun and foreign lockfiles for mixed-package-manager detection. |
| workspace | Bun workspace with root and package manifests. |
| bun-test | Uses `bun:test` in a test file. |
| bun-runtime-apis | Uses Bun runtime APIs, `bun:sqlite`, and `node:*` imports. |
| ignored-output | Contains ignored directories used to verify skip behavior. |
| secret-files | Contains secret-like files that analyzers must not read. |
