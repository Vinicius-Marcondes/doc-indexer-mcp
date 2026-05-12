import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ProjectAnalysisStore, hashProjectPath } from "../../../src/resources/project-analysis-store";
import { readBunProjectAnalysisResource } from "../../../src/resources/bun-project-analysis-resource";
import { analyzeBunProject } from "../../../src/tools/analyze-bun-project";

const testDir = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(testDir, "../../fixtures/projects");
const tempDirs: string[] = [];
const now = "2026-05-12T10:00:00.000Z";

function tempProject(source = "export const ok = true;"): string {
  const dir = mkdtempSync(resolve(tmpdir(), "bun-dev-intel-project-resource-"));
  tempDirs.push(dir);
  mkdirSync(resolve(dir, "src"), { recursive: true });
  writeFileSync(resolve(dir, "package.json"), JSON.stringify({ name: "resource-fixture", type: "module" }));
  writeFileSync(resolve(dir, "src/index.ts"), source);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("bun-project://analysis/{projectHash} resource", () => {
  test("resource is created after project analysis", () => {
    const store = new ProjectAnalysisStore({ now: () => now });
    const projectPath = resolve(fixturesDir, "minimal-bun-ts");
    const analysis = analyzeBunProject({ projectPath }, { analysisStore: store, now: () => now });

    expect(analysis.ok).toBe(true);

    if (analysis.ok) {
      const result = readBunProjectAnalysisResource({ projectHash: analysis.projectHash }, { store, now: () => now });

      expect(result.ok).toBe(true);

      if (result.ok) {
        expect(result.uri).toBe(`bun-project://analysis/${analysis.projectHash}`);
        expect(result.projectHash).toBe(hashProjectPath(projectPath));
        expect(result.projectPath).toBe(projectPath);
        expect(result.generatedAt).toBe(now);
        expect(result.sourceFileCount).toBe(1);
      }
    }
  });

  test("resource returns cached analysis", () => {
    const store = new ProjectAnalysisStore({ now: () => now });
    const projectPath = resolve(fixturesDir, "minimal-bun-ts");
    const analysis = analyzeBunProject({ projectPath }, { analysisStore: store, now: () => now });

    expect(analysis.ok).toBe(true);

    if (analysis.ok) {
      const result = readBunProjectAnalysisResource({ projectHash: analysis.projectHash }, { store, now: () => now });

      expect(result.ok).toBe(true);

      if (result.ok) {
        expect(result.cacheStatus).toBe("fresh");
        expect(result.analysis.packageManager.name).toBe("bun");
        expect(result.fileHashes).toHaveLength(result.sourceFileCount);
        expect(result.fileHashes[0]?.contentHash).toMatch(/^[a-f0-9]{64}$/u);
      }
    }
  });

  test("resource does not include secret file content", () => {
    const secretContent = "SECRET_TOKEN_SHOULD_NOT_LEAK";
    const projectPath = tempProject();
    writeFileSync(resolve(projectPath, "src/private.key"), secretContent);
    const store = new ProjectAnalysisStore({ now: () => now });
    const analysis = analyzeBunProject({ projectPath }, { analysisStore: store, now: () => now });

    expect(analysis.ok).toBe(true);

    if (analysis.ok) {
      const result = readBunProjectAnalysisResource({ projectHash: analysis.projectHash }, { store, now: () => now });

      expect(result.ok).toBe(true);
      expect(JSON.stringify(result)).not.toContain(secretContent);
    }
  });

  test("changed source files mark analysis stale", () => {
    const projectPath = tempProject("export const value = 1;");
    const store = new ProjectAnalysisStore({ now: () => now });
    const analysis = analyzeBunProject({ projectPath }, { analysisStore: store, now: () => now });

    expect(analysis.ok).toBe(true);

    if (analysis.ok) {
      writeFileSync(resolve(projectPath, "src/index.ts"), "export const value = 2;");

      const result = readBunProjectAnalysisResource({ projectHash: analysis.projectHash }, { store, now: () => now });

      expect(result.ok).toBe(true);

      if (result.ok) {
        expect(result.cacheStatus).toBe("stale");
        expect(result.warnings.map((warning) => warning.id)).toContain("project-analysis-stale");
      }
    }
  });

  test("unknown analysis hash returns structured error", () => {
    const store = new ProjectAnalysisStore({ now: () => now });
    const result = readBunProjectAnalysisResource({ projectHash: "a".repeat(64) }, { store, now: () => now });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe("no_evidence");
    }
  });
});
