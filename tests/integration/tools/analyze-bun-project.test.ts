import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeBunProject } from "../../../src/tools/analyze-bun-project";

const testDir = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(testDir, "../../fixtures/projects");
const tempDirs: string[] = [];

function tempProjectWithNodeModules(): string {
  const dir = mkdtempSync(resolve(tmpdir(), "bun-dev-intel-analyze-tool-"));
  tempDirs.push(dir);
  const sourcePath = resolve(dir, "src/index.ts");
  const dependencyPath = resolve(dir, "src/node_modules/pkg/index.ts");
  mkdirSync(dirname(sourcePath), { recursive: true });
  mkdirSync(dirname(dependencyPath), { recursive: true });
  writeFileSync(resolve(dir, "package.json"), JSON.stringify({ type: "module" }));
  writeFileSync(sourcePath, "export const ok = true;");
  writeFileSync(dependencyPath, "Bun.serve({ fetch: () => new Response('should-not-read') });");
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("analyze_bun_project tool", () => {
  test("valid fixture returns project profile", () => {
    const result = analyzeBunProject({ projectPath: resolve(fixturesDir, "minimal-bun-ts") });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.projectPath).toBe(resolve(fixturesDir, "minimal-bun-ts"));
      expect(result.packageManager.name).toBe("bun");
      expect(result.packageJson.exists).toBe(true);
      expect(result.tsconfig.exists).toBe(true);
      expect(result.cacheStatus).toBe("disabled");
    }
  });

  test("missing project path fails validation", () => {
    const result = analyzeBunProject({});

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe("invalid_input");
    }
  });

  test("node_modules fixture is not read", () => {
    const result = analyzeBunProject({ projectPath: tempProjectWithNodeModules() });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.sourceAnalysis.discovery.skipped.ignoredDirectories.node_modules).toBe(1);
      expect(result.sourceAnalysis.bunGlobals.findings).toEqual([]);
    }
  });

  test("missing @types/bun produces recommendation", () => {
    const result = analyzeBunProject({ projectPath: resolve(fixturesDir, "missing-bun-types") });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.recommendations.map((recommendation) => recommendation.id)).toContain("missing-types-bun-package");
    }
  });

  test("mixed lockfiles produce warning", () => {
    const result = analyzeBunProject({ projectPath: resolve(fixturesDir, "mixed-lockfiles") });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.warnings.map((warning) => warning.id)).toContain("mixed-lockfiles");
      expect(result.recommendations.map((recommendation) => recommendation.id)).toContain("mixed-lockfiles");
    }
  });

  test("Bun API usage appears in sourceAnalysis", () => {
    const result = analyzeBunProject({ projectPath: resolve(fixturesDir, "bun-runtime-apis") });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.sourceAnalysis.bunGlobals.usages.serve?.count).toBe(1);
      expect(result.sourceAnalysis.imports.imports.map((item) => item.specifier)).toContain("bun:sqlite");
    }
  });
});
