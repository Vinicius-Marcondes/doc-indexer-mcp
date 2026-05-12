import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { reviewBunProject } from "../../../src/tools/review-bun-project";

const testDir = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(testDir, "../../fixtures/projects");
const tempDirs: string[] = [];

function emptyProject(): string {
  const dir = mkdtempSync(resolve(tmpdir(), "bun-dev-intel-review-tool-"));
  tempDirs.push(dir);
  writeFileSync(resolve(dir, "package.json"), JSON.stringify({ type: "module" }));
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("review_bun_project tool", () => {
  test('focus "all" returns summary and key risks', () => {
    const result = reviewBunProject({ projectPath: resolve(fixturesDir, "mixed-lockfiles"), focus: "all" });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.summary).toContain("mixed-lockfiles");
      expect(result.keyRisks.map((risk) => risk.id)).toContain("mixed-lockfiles");
    }
  });

  test('focus "typescript" returns TypeScript-specific findings', () => {
    const result = reviewBunProject({ projectPath: resolve(fixturesDir, "missing-bun-types"), focus: "typescript" });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.recommendedNextActions.map((action) => action.id)).toEqual(
        expect.arrayContaining(["missing-types-bun-package", "missing-tsconfig-bun-types"])
      );
    }
  });

  test('focus "dependencies" includes package-manager and dependency context', () => {
    const result = reviewBunProject({ projectPath: resolve(fixturesDir, "mixed-lockfiles"), focus: "dependencies" });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.projectProfile.packageManager).toBe("bun");
      expect(result.projectProfile.lockfiles).toEqual(["bun.lock", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"]);
    }
  });

  test("recommended validation commands are not executed", () => {
    const result = reviewBunProject({ projectPath: resolve(fixturesDir, "bun-test"), focus: "tests" });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.validationCommandsForAgent).toContain("bun test");
      expect(result.summary).not.toContain("executed");
    }
  });

  test("missing evidence lowers confidence", () => {
    const result = reviewBunProject({ projectPath: emptyProject(), focus: "all" });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.confidence).toBe("low");
      expect(result.warnings.map((warning) => warning.id)).toContain("confidence-missing-official-sources");
    }
  });
});
