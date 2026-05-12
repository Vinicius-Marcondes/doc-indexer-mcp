import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseTsconfig } from "../../../src/analyzers/tsconfig";

const testDir = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(testDir, "../../fixtures/projects");
const tempDirs: string[] = [];

function tempProject(tsconfig: string): string {
  const dir = mkdtempSync(resolve(tmpdir(), "bun-dev-intel-tsconfig-"));
  tempDirs.push(dir);
  writeFileSync(resolve(dir, "tsconfig.json"), tsconfig);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("tsconfig analyzer", () => {
  test("parses Bun-recommended settings", () => {
    const result = parseTsconfig(resolve(fixturesDir, "minimal-bun-ts"));

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.tsconfig.exists).toBe(true);
      expect(result.tsconfig.compilerOptions).toEqual({
        types: ["bun"],
        moduleResolution: "bundler",
        module: "Preserve",
        target: "ESNext",
        noEmit: true,
        strict: true
      });
      expect(result.tsconfig.detected.hasBunTypes).toBe(true);
      expect(result.tsconfig.detected.usesBundlerModuleResolution).toBe(true);
      expect(result.tsconfig.warnings).toEqual([]);
    }
  });

  test("detects missing types bun", () => {
    const result = parseTsconfig(resolve(fixturesDir, "missing-bun-types"));

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.tsconfig.detected.hasBunTypes).toBe(false);
      expect(result.tsconfig.warnings[0]?.id).toBe("tsconfig-missing-bun-types");
    }
  });

  test("detects non-bundler module resolution", () => {
    const projectDir = tempProject(`{
      // JSONC comment should be accepted
      "compilerOptions": {
        "moduleResolution": "node16",
        "module": "Node16"
      }
    }`);

    const result = parseTsconfig(projectDir);

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.tsconfig.compilerOptions.moduleResolution).toBe("node16");
      expect(result.tsconfig.detected.usesBundlerModuleResolution).toBe(false);
      expect(result.tsconfig.warnings.map((warning) => warning.id)).toContain("tsconfig-non-bundler-resolution");
    }
  });

  test("handles missing tsconfig", () => {
    const dir = mkdtempSync(resolve(tmpdir(), "bun-dev-intel-tsconfig-missing-"));
    tempDirs.push(dir);

    const result = parseTsconfig(dir);

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.tsconfig.exists).toBe(false);
      expect(result.tsconfig.compilerOptions).toEqual({});
    }
  });

  test("handles invalid tsconfig", () => {
    const projectDir = tempProject("{ invalid json");

    const result = parseTsconfig(projectDir);

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe("parse_failed");
      expect(result.error.message).toContain("tsconfig.json");
    }
  });
});
