import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverSourceFiles } from "../../../src/analyzers/source-discovery";

const testDir = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(testDir, "../../fixtures/projects");
const tempDirs: string[] = [];

function tempProject(): string {
  const dir = mkdtempSync(resolve(tmpdir(), "bun-dev-intel-source-discovery-"));
  tempDirs.push(dir);
  return dir;
}

function writeProjectFile(projectRoot: string, path: string, content: string): void {
  const absolutePath = resolve(projectRoot, path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("source file discovery", () => {
  test("finds source files in common directories", () => {
    const result = discoverSourceFiles(resolve(fixturesDir, "minimal-bun-ts"));

    expect(result.files.map((file) => file.relativePath)).toEqual(["src/index.ts"]);
  });

  test("finds workspace package source files", () => {
    const result = discoverSourceFiles(resolve(fixturesDir, "workspace"));

    expect(result.files.map((file) => file.relativePath).sort()).toEqual([
      "packages/api/src/index.ts",
      "packages/shared/src/index.ts"
    ]);
  });

  test("skips ignored directories", () => {
    const projectRoot = tempProject();
    writeProjectFile(projectRoot, "src/index.ts", "export const ok = true;");
    writeProjectFile(projectRoot, "src/dist/generated.ts", "export const generated = true;");
    writeProjectFile(projectRoot, "src/node_modules/pkg/index.ts", "export const dependency = true;");

    const result = discoverSourceFiles(projectRoot);

    expect(result.files.map((file) => file.relativePath)).toEqual(["src/index.ts"]);
    expect(result.skipped.ignoredDirectories).toEqual({
      dist: 1,
      node_modules: 1
    });
  });

  test("skips oversized files", () => {
    const projectRoot = tempProject();
    writeProjectFile(projectRoot, "src/small.ts", "export const small = true;");
    writeProjectFile(projectRoot, "src/large.ts", "x".repeat(128));

    const result = discoverSourceFiles(projectRoot, { maxFileSizeBytes: 64 });

    expect(result.files.map((file) => file.relativePath)).toEqual(["src/small.ts"]);
    expect(result.skipped.oversizedFiles).toEqual(["src/large.ts"]);
  });

  test("skips binary files", () => {
    const projectRoot = tempProject();
    writeProjectFile(projectRoot, "src/index.ts", "export const ok = true;");
    writeProjectFile(projectRoot, "src/native.node", "binary");

    const result = discoverSourceFiles(projectRoot);

    expect(result.files.map((file) => file.relativePath)).toEqual(["src/index.ts"]);
    expect(result.skipped.binaryFiles).toEqual(["src/native.node"]);
  });

  test("never traverses into node_modules", () => {
    const projectRoot = tempProject();
    writeProjectFile(projectRoot, "src/index.ts", "export const ok = true;");
    writeProjectFile(projectRoot, "src/node_modules/pkg/index.ts", "export const dependency = true;");

    const result = discoverSourceFiles(projectRoot);

    expect(result.files.map((file) => file.relativePath)).not.toContain("src/node_modules/pkg/index.ts");
    expect(result.skipped.ignoredDirectories.node_modules).toBe(1);
  });
});
