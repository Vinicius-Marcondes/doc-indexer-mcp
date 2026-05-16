import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const rootDir = resolve(import.meta.dir, "../../..");
const taskDir = "docs/tasks/bun-dev-intel-mcp-admin-reintegration-monorepo";
const prdPath = "docs/prd/bun-dev-intel-mcp-admin-reintegration-monorepo-architecture.md";

function read(path: string): string {
  return readFileSync(resolve(rootDir, path), "utf8");
}

describe("admin reintegration monorepo planning", () => {
  test("PRD records the target monorepo architecture decisions", () => {
    const prd = read(prdPath);

    expect(prd).toContain("Do not adopt BHVR as a framework-level dependency");
    expect(prd).toContain("Keep migrations at root under `migrations/remote-docs/`");
    expect(prd).toContain("apps/mcp-http");
    expect(prd).toContain("packages/docs-domain");
    expect(prd).toContain("Implementation must be test-driven");
  });

  test("tracker and traceability checklist exist for the reintegration work", () => {
    expect(existsSync(resolve(rootDir, taskDir, "TRACKER.md"))).toBe(true);
    expect(existsSync(resolve(rootDir, taskDir, "traceability-checklist.md"))).toBe(true);

    const tracker = read(`${taskDir}/TRACKER.md`);
    const traceability = read(`${taskDir}/traceability-checklist.md`);

    expect(tracker).toContain("Keep exactly one task `in_progress`");
    expect(tracker).toContain("Admin Console Reintegration And Monorepo Architecture");
    expect(traceability).toContain("Single Git repository");
    expect(traceability).toContain("One migration stream");
    expect(traceability).toContain("Shared docs-domain implementation");
  });

  test("task files cover the incremental migration phases", () => {
    const expectedTasks = [
      "00-architecture-tracker-and-traceability.md",
      "01-workspace-package-naming-plan.md",
      "02-root-workspace-scaffold.md",
      "03-import-admin-contracts.md",
      "04-import-admin-server-and-client.md",
      "05-import-admin-migrations.md",
      "06-admin-migration-storage-tests.md",
      "07-extract-db-package.md",
      "08-extract-contracts-package.md",
      "09-extract-docs-domain-package.md",
      "10-wire-mcp-http-to-shared-packages.md",
      "11-wire-docs-worker-to-shared-packages.md",
      "12-wire-admin-server-to-shared-packages.md",
      "13-move-runtime-entrypoints-into-apps.md",
      "14-update-docker-compose.md",
      "15-update-docs-and-agents.md",
      "16-add-import-boundary-checks.md",
      "17-final-cleanup-and-traceability.md"
    ];

    for (const task of expectedTasks) {
      const path = `${taskDir}/${task}`;
      expect(existsSync(resolve(rootDir, path))).toBe(true);
      expect(read(path)).toContain("## Acceptance Criteria");
      expect(read(path)).toContain("## Required Tests");
    }
  });

  test("package naming plan records internal workspace names and dependency direction", () => {
    const plan = read(`${taskDir}/package-naming-plan.md`);

    for (const packageName of [
      "@bun-dev-intel/docs-domain",
      "@bun-dev-intel/db",
      "@bun-dev-intel/contracts",
      "@bun-dev-intel/admin-contracts",
      "@bun-dev-intel/config",
      "@bun-dev-intel/mcp-http",
      "@bun-dev-intel/docs-worker",
      "@bun-dev-intel/admin-console-server",
      "@bun-dev-intel/admin-console-client"
    ]) {
      expect(plan).toContain(packageName);
    }

    expect(plan).toContain("No package is published externally in V1");
    expect(plan).toContain("apps/* -> packages/*");
    expect(plan).toContain("packages/* must not import apps/*");
  });

  test("README and AGENTS describe the reintegrated monorepo boundaries", () => {
    const readme = read("README.md");
    const agents = read("AGENTS.md");

    for (const expected of [
      "apps/mcp-http",
      "apps/docs-worker",
      "apps/admin-console/server",
      "apps/admin-console/client",
      "packages/docs-domain",
      "packages/db"
    ]) {
      expect(readme).toContain(expected);
      expect(agents).toContain(expected);
    }

    expect(readme).not.toContain("does not include local project analysis, stdio MCP transport, or an admin console");
    expect(agents).not.toContain("Keep local project analysis, stdio transport, and admin-console runtime code out");
    expect(agents).toContain("Never read inside `node_modules`");
    expect(agents).toContain("Never run `git push origin master`");
  });
});
