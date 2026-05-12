import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeBunGlobals } from "../../../src/analyzers/ast-bun-globals";
import { discoverSourceFiles } from "../../../src/analyzers/source-discovery";

const testDir = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(testDir, "../../fixtures/projects");
const tempDirs: string[] = [];

function tempProject(fileContent: string): string {
  const dir = mkdtempSync(resolve(tmpdir(), "bun-dev-intel-ast-bun-"));
  tempDirs.push(dir);
  const filePath = resolve(dir, "src/index.ts");
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, fileContent);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("AST Bun global analysis", () => {
  test("detects Bun.serve", () => {
    const files = discoverSourceFiles(resolve(fixturesDir, "bun-runtime-apis")).files;
    const analysis = analyzeBunGlobals(files);

    expect(analysis.usages.serve?.count).toBe(1);
  });

  test("detects Bun.file", () => {
    const files = discoverSourceFiles(resolve(fixturesDir, "bun-runtime-apis")).files;
    const analysis = analyzeBunGlobals(files);

    expect(analysis.usages.file?.count).toBe(1);
  });

  test("detects Bun.write", () => {
    const files = discoverSourceFiles(resolve(fixturesDir, "bun-runtime-apis")).files;
    const analysis = analyzeBunGlobals(files);

    expect(analysis.usages.write?.count).toBe(1);
  });

  test("detects Bun.spawn", () => {
    const files = discoverSourceFiles(resolve(fixturesDir, "bun-runtime-apis")).files;
    const analysis = analyzeBunGlobals(files);

    expect(analysis.usages.spawn?.count).toBe(1);
  });

  test("detects Bun.password", () => {
    const projectRoot = tempProject(`
export async function hash(value: string) {
  return Bun.password.hash(value);
}
`);
    const analysis = analyzeBunGlobals(discoverSourceFiles(projectRoot).files);

    expect(analysis.usages.password?.count).toBe(1);
  });

  test("detects Bun.env", () => {
    const files = discoverSourceFiles(resolve(fixturesDir, "bun-runtime-apis")).files;
    const analysis = analyzeBunGlobals(files);

    expect(analysis.usages.env?.count).toBe(1);
  });

  test("handles syntax errors gracefully", () => {
    const projectRoot = tempProject(`
export function broken( {
Bun.serve();
`);
    const analysis = analyzeBunGlobals(discoverSourceFiles(projectRoot).files);

    expect(analysis.warnings.map((warning) => warning.id)).toContain("bun-global-parse-diagnostic");
  });

  test("handles local Bun shadowing according to confidence policy", () => {
    const projectRoot = tempProject(`
const Bun = { serve() { return "local"; } };
Bun.serve();
`);
    const analysis = analyzeBunGlobals(discoverSourceFiles(projectRoot).files);

    expect(analysis.findings).toEqual([]);
    expect(analysis.warnings[0]?.id).toBe("bun-global-shadowed");
  });
});
