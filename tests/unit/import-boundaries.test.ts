import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";

const rootDir = resolve(import.meta.dir, "../..");

function listFiles(dir: string): string[] {
  return readdirSync(resolve(rootDir, dir))
    .filter((entry) => entry !== "node_modules" && entry !== "dist")
    .flatMap((entry) => {
      const path = resolve(rootDir, dir, entry);
      const relativePath = relative(rootDir, path);
      return statSync(path).isDirectory() ? listFiles(relativePath) : [relativePath];
    });
}

function sourceFiles(dir: string): string[] {
  return listFiles(dir).filter((path) => /\.(ts|tsx|json)$/u.test(path));
}

function read(path: string): string {
  return readFileSync(resolve(rootDir, path), "utf8");
}

function combined(files: readonly string[]): string {
  return files.map((path) => `\n// ${path}\n${read(path)}`).join("\n");
}

function expectNoForbidden(content: string, forbidden: readonly string[]): void {
  for (const value of forbidden) {
    expect(content).not.toContain(value);
  }
}

describe("monorepo import boundaries", () => {
  test("packages do not import applications", () => {
    const packageSource = combined(sourceFiles("packages"));

    expectNoForbidden(packageSource, [
      "apps/",
      "../apps/",
      "../../apps/",
      "../../../apps/",
      "@bun-dev-intel/mcp-http",
      "@bun-dev-intel/docs-worker",
      "@bun-dev-intel/admin-console-server",
      "@bun-dev-intel/admin-console-client"
    ]);
  });

  test("admin client imports only browser-safe workspace packages", () => {
    const clientSource = combined(sourceFiles("apps/admin-console/client"));
    const packageJson = JSON.parse(read("apps/admin-console/client/package.json")) as {
      readonly dependencies?: Record<string, string>;
      readonly devDependencies?: Record<string, string>;
    };
    const dependencyNames = [...Object.keys(packageJson.dependencies ?? {}), ...Object.keys(packageJson.devDependencies ?? {})];

    expect(packageJson.dependencies?.["@bun-dev-intel/admin-contracts"]).toBe("workspace:*");
    expect(dependencyNames).not.toContain("@bun-dev-intel/db");
    expect(dependencyNames).not.toContain("@bun-dev-intel/docs-domain");
    expect(dependencyNames).not.toContain("@bun-dev-intel/contracts");
    expect(dependencyNames).not.toContain("@bun-dev-intel/admin-console-server");
    expectNoForbidden(clientSource, [
      "@bun-dev-intel/db",
      "@bun-dev-intel/docs-domain",
      "@bun-dev-intel/contracts",
      "@bun-dev-intel/admin-console-server",
      "apps/admin-console/server",
      "../server",
      "../../server",
      "../../../src/",
      "process.env",
      "Bun.env"
    ]);
  });

  test("runtime apps do not import each other", () => {
    const mcpHttpSource = combined(sourceFiles("apps/mcp-http"));
    const docsWorkerSource = combined(sourceFiles("apps/docs-worker"));
    const adminServerSource = combined(sourceFiles("apps/admin-console/server"));

    expectNoForbidden(mcpHttpSource, ["apps/admin-console", "apps/docs-worker", "@bun-dev-intel/admin-console-server", "@bun-dev-intel/docs-worker"]);
    expectNoForbidden(docsWorkerSource, ["apps/admin-console", "apps/mcp-http", "@bun-dev-intel/admin-console-server", "@bun-dev-intel/mcp-http"]);
    expectNoForbidden(adminServerSource, ["apps/mcp-http", "apps/docs-worker", "@bun-dev-intel/mcp-http", "@bun-dev-intel/docs-worker"]);
  });

  test("admin app does not carry a duplicated docs-domain implementation", () => {
    expect(existsSync(resolve(rootDir, "apps/admin-console/server/src/docs"))).toBe(false);
    expect(existsSync(resolve(rootDir, "apps/admin-console/client/src/docs"))).toBe(false);
  });
});
