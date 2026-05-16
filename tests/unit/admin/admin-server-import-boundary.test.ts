import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const rootDir = resolve(import.meta.dir, "../../..");
const adminServerDir = resolve(rootDir, "apps/admin-console/server");

function listFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((entry) => entry !== "node_modules" && entry !== "dist")
    .flatMap((entry) => {
      const path = resolve(dir, entry);
      return statSync(path).isDirectory() ? listFiles(path) : [path];
    });
}

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("admin server import boundary", () => {
  test("admin server source consumes shared packages instead of root docs/tools internals", () => {
    const combined = listFiles(resolve(adminServerDir, "src"))
      .filter((path) => path.endsWith(".ts"))
      .map(read)
      .join("\n");

    expect(combined).toContain("@bun-dev-intel/admin-contracts");
    expect(combined).toContain("@bun-dev-intel/db");
    expect(combined).toContain("@bun-dev-intel/docs-domain");
    expect(combined).not.toContain("../../../../src/docs/");
    expect(combined).not.toContain("../../../../../src/docs/");
    expect(combined).not.toContain("../../../../src/tools/");
    expect(combined).not.toContain("../../../../../src/tools/");
  });

  test("admin server declares shared runtime package dependencies", () => {
    const packageJson = JSON.parse(read(resolve(adminServerDir, "package.json"))) as {
      readonly dependencies?: Record<string, string>;
    };

    expect(packageJson.dependencies?.["@bun-dev-intel/admin-contracts"]).toBe("workspace:*");
    expect(packageJson.dependencies?.["@bun-dev-intel/db"]).toBe("workspace:*");
    expect(packageJson.dependencies?.["@bun-dev-intel/docs-domain"]).toBe("workspace:*");
  });
});
