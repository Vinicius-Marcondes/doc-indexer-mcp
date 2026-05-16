import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const rootDir = resolve(import.meta.dir, "../..");

function read(path: string): string {
  return readFileSync(resolve(rootDir, path), "utf8");
}

describe("HTTP project import boundary", () => {
  test("local stdio and analyzer source trees are not present in the HTTP runtime", () => {
    for (const removedPath of [
      "src/stdio.ts",
      "src/analyzers",
      "src/security",
      "src/recommendations"
    ]) {
      expect(existsSync(resolve(rootDir, removedPath))).toBe(false);
    }
  });

  test("HTTP entrypoints import only remote docs server surfaces", () => {
    const combined = [read("src/http.ts"), read("src/http/mcp.ts"), read("src/server.ts")].join("\n");

    for (const forbidden of [
      "createBunDevIntelServer",
      "registerBunDevIntelCapabilities",
      "analyze-bun-project",
      "project-health",
      "lint-bun-file",
      "plan-bun-dependency",
      "review-bun-project",
      "typescript"
    ]) {
      expect(combined).not.toContain(forbidden);
    }

    expect(combined).toContain("createRemoteDocsMcpServer");
    expect(combined).toContain("registerRemoteDocsCapabilities");
    expect(combined).not.toContain("apps/admin-console");
    expect(combined).toContain("../packages/db/src");
    expect(combined).toContain("../packages/docs-domain/src");
    expect(combined).not.toContain("./docs/storage/");
    expect(combined).not.toContain("./docs/retrieval/");
    expect(combined).not.toContain("./docs/refresh/");
  });

  test("package and Docker metadata do not reference split-out projects", () => {
    const packageJson = JSON.parse(read("package.json")) as {
      readonly workspaces?: unknown;
      readonly scripts?: Record<string, string>;
    };
    const dockerfile = read("Dockerfile");

    expect(packageJson.workspaces).toEqual(["apps/*", "apps/admin-console/*", "packages/*"]);
    expect(dockerfile).not.toContain("apps/admin-console");
    expect(dockerfile).not.toContain("admin-console");
    expect(dockerfile).not.toContain("TypeScript compiler API");
  });
});
