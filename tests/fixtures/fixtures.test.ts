import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";

const projectsDir = resolve(import.meta.dir, "projects");

const requiredFixtures = [
  "minimal-bun-ts",
  "missing-bun-types",
  "legacy-lockb",
  "mixed-lockfiles",
  "workspace",
  "bun-test",
  "bun-runtime-apis",
  "ignored-output",
  "secret-files"
] as const;

function expectFixtureFile(fixture: string, path: string) {
  expect(existsSync(resolve(projectsDir, fixture, path))).toBe(true);
}

function collectNodeModulesDirs(startDir: string): string[] {
  const found: string[] = [];

  function walk(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }

      const entryPath = resolve(dir, entry.name);

      if (entry.name === "node_modules") {
        found.push(relative(projectsDir, entryPath));
        continue;
      }

      walk(entryPath);
    }
  }

  walk(startDir);
  return found.sort();
}

describe("fixture projects", () => {
  test("include every required fixture and a manifest", () => {
    expect(existsSync(resolve(projectsDir, "manifest.md"))).toBe(true);

    for (const fixture of requiredFixtures) {
      expect(existsSync(resolve(projectsDir, fixture))).toBe(true);
    }
  });

  test("include files needed by analyzer scenarios", () => {
    expectFixtureFile("minimal-bun-ts", "package.json");
    expectFixtureFile("minimal-bun-ts", "bun.lock");
    expectFixtureFile("minimal-bun-ts", "tsconfig.json");
    expectFixtureFile("minimal-bun-ts", "src/index.ts");

    expectFixtureFile("missing-bun-types", "package.json");
    expectFixtureFile("missing-bun-types", "tsconfig.json");
    expectFixtureFile("missing-bun-types", "src/index.ts");

    expectFixtureFile("legacy-lockb", "package.json");
    expectFixtureFile("legacy-lockb", "bun.lockb");

    expectFixtureFile("mixed-lockfiles", "package.json");
    expectFixtureFile("mixed-lockfiles", "bun.lock");
    expectFixtureFile("mixed-lockfiles", "package-lock.json");
    expectFixtureFile("mixed-lockfiles", "pnpm-lock.yaml");
    expectFixtureFile("mixed-lockfiles", "yarn.lock");

    expectFixtureFile("workspace", "package.json");
    expectFixtureFile("workspace", "packages/api/package.json");
    expectFixtureFile("workspace", "packages/shared/package.json");

    expectFixtureFile("bun-test", "tests/math.test.ts");
    expectFixtureFile("bun-runtime-apis", "src/server.ts");
    expectFixtureFile("secret-files", ".env");
  });

  test("contains ignored directories only in the ignored-output fixture", () => {
    expect(existsSync(resolve(projectsDir, "ignored-output/node_modules"))).toBe(true);
    expect(existsSync(resolve(projectsDir, "ignored-output/dist"))).toBe(true);
    expect(existsSync(resolve(projectsDir, "ignored-output/build"))).toBe(true);
    expect(existsSync(resolve(projectsDir, "ignored-output/.cache"))).toBe(true);
    expect(existsSync(resolve(projectsDir, "ignored-output/coverage"))).toBe(true);

    expect(collectNodeModulesDirs(projectsDir)).toEqual(["ignored-output/node_modules"]);
  });
});
