import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parsePackageJson } from "../../../src/analyzers/package-json";

const testDir = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(testDir, "../../fixtures/projects");
const tempDirs: string[] = [];

function tempProject(): string {
  const dir = mkdtempSync(resolve(tmpdir(), "bun-dev-intel-package-json-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("package.json analyzer", () => {
  test("parses scripts", () => {
    const result = parsePackageJson(resolve(fixturesDir, "minimal-bun-ts"));

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.packageJson.exists).toBe(true);
      expect(result.packageJson.scripts).toEqual({
        test: "bun test",
        typecheck: "tsc --noEmit",
        dev: "bun src/index.ts"
      });
    }
  });

  test("parses dependencies and dev dependencies", () => {
    const result = parsePackageJson(resolve(fixturesDir, "minimal-bun-ts"));

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.packageJson.dependencies).toEqual({
        zod: "^4.0.0"
      });
      expect(result.packageJson.devDependencies).toEqual({
        "@types/bun": "^1.3.0",
        typescript: "^5.9.0"
      });
      expect(result.packageJson.optionalDependencies).toEqual({});
    }
  });

  test("detects @types/bun and TypeScript", () => {
    const result = parsePackageJson(resolve(fixturesDir, "minimal-bun-ts"));

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.packageJson.detected.hasTypesBun).toBe(true);
      expect(result.packageJson.detected.hasTypeScript).toBe(true);
      expect(result.packageJson.detected.bunRelatedPackages).toEqual(["@types/bun"]);
    }
  });

  test("detects workspaces", () => {
    const result = parsePackageJson(resolve(fixturesDir, "workspace"));

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.packageJson.workspaces).toEqual(["packages/*"]);
    }
  });

  test("handles missing package.json", () => {
    const result = parsePackageJson(tempProject());

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.packageJson.exists).toBe(false);
      expect(result.packageJson.dependencies).toEqual({});
      expect(result.packageJson.scripts).toEqual({});
    }
  });

  test("handles invalid package.json", () => {
    const projectDir = tempProject();
    writeFileSync(resolve(projectDir, "package.json"), "{ invalid json");

    const result = parsePackageJson(projectDir);

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe("parse_failed");
      expect(result.error.message).toContain("package.json");
    }
  });
});
