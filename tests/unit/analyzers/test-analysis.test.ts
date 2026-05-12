import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeTests } from "../../../src/analyzers/test-analysis";

const testDir = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(testDir, "../../fixtures/projects");
const tempDirs: string[] = [];

function tempProject(files: Record<string, string>): string {
  const dir = mkdtempSync(resolve(tmpdir(), "bun-dev-intel-test-analysis-"));
  tempDirs.push(dir);

  for (const [path, content] of Object.entries(files)) {
    const filePath = resolve(dir, path);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content);
  }

  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("test analysis", () => {
  test("finds *.test.ts", () => {
    const analysis = analyzeTests(resolve(fixturesDir, "bun-test"));

    expect(analysis.testFiles).toEqual(["tests/math.test.ts"]);
  });

  test("finds *.spec.ts", () => {
    const projectRoot = tempProject({
      "package.json": JSON.stringify({ type: "module" }),
      "tests/math.spec.ts": 'import { test } from "bun:test"; test("ok", () => {});'
    });

    const analysis = analyzeTests(projectRoot);

    expect(analysis.testFiles).toEqual(["tests/math.spec.ts"]);
  });

  test("detects bun:test imports", () => {
    const analysis = analyzeTests(resolve(fixturesDir, "bun-test"));

    expect(analysis.hasBunTestImport).toBe(true);
    expect(analysis.bunTestImports).toEqual(["tests/math.test.ts"]);
  });

  test("detects functions imported from bun:test", () => {
    const analysis = analyzeTests(resolve(fixturesDir, "bun-test"));

    expect(analysis.bunTestFunctions).toEqual(["expect", "test"]);
  });

  test("detects test script using bun test", () => {
    const analysis = analyzeTests(resolve(fixturesDir, "bun-test"));

    expect(analysis.testScript).toBe("bun test");
    expect(analysis.usesBunTestScript).toBe(true);
  });

  test("warns when Bun tests exist but no test script exists", () => {
    const projectRoot = tempProject({
      "package.json": JSON.stringify({ type: "module" }),
      "tests/math.test.ts": 'import { expect, test } from "bun:test"; test("ok", () => expect(1).toBe(1));'
    });

    const analysis = analyzeTests(projectRoot);

    expect(analysis.hasBunTestImport).toBe(true);
    expect(analysis.usesBunTestScript).toBe(false);
    expect(analysis.warnings[0]?.id).toBe("bun-test-missing-script");
  });
});
