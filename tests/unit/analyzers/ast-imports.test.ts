import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeImports } from "../../../src/analyzers/ast-imports";
import { discoverSourceFiles } from "../../../src/analyzers/source-discovery";

const testDir = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(testDir, "../../fixtures/projects");
const tempDirs: string[] = [];

function tempProject(fileContent: string): string {
  const dir = mkdtempSync(resolve(tmpdir(), "bun-dev-intel-ast-imports-"));
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

describe("AST import analysis", () => {
  test("detects bun:test", () => {
    const files = discoverSourceFiles(resolve(fixturesDir, "bun-test")).files;
    const analysis = analyzeImports(files);

    expect(analysis.imports.map((item) => item.specifier)).toContain("bun:test");
    expect(analysis.imports.find((item) => item.specifier === "bun:test")?.kind).toBe("bun-test");
  });

  test("detects bun:sqlite", () => {
    const files = discoverSourceFiles(resolve(fixturesDir, "bun-runtime-apis")).files;
    const analysis = analyzeImports(files);

    expect(analysis.imports.find((item) => item.specifier === "bun:sqlite")?.kind).toBe("bun-sqlite");
  });

  test("detects node:fs", () => {
    const files = discoverSourceFiles(resolve(fixturesDir, "bun-runtime-apis")).files;
    const analysis = analyzeImports(files);

    expect(analysis.imports.find((item) => item.specifier === "node:fs")?.kind).toBe("node");
  });

  test("detects package imports", () => {
    const files = discoverSourceFiles(resolve(fixturesDir, "bun-runtime-apis")).files;
    const analysis = analyzeImports(files);

    expect(analysis.imports.find((item) => item.specifier === "hono")?.kind).toBe("package");
  });

  test("detects relative imports", () => {
    const files = discoverSourceFiles(resolve(fixturesDir, "bun-runtime-apis")).files;
    const analysis = analyzeImports(files);

    expect(analysis.imports.find((item) => item.specifier === "./util")?.kind).toBe("relative");
  });

  test("detects dynamic imports", () => {
    const projectRoot = tempProject(`
export async function load() {
  return import("zod");
}
`);
    const files = discoverSourceFiles(projectRoot).files;
    const file = files[0];
    expect(file).toBeDefined();

    if (file === undefined) {
      return;
    }

    const analysis = analyzeImports(files);

    expect(analysis.imports).toEqual([
      {
        specifier: "zod",
        kind: "package",
        importKind: "dynamic",
        filePath: file.path,
        relativePath: "src/index.ts",
        line: 3
      }
    ]);
  });

  test("does not use regex-only parsing", () => {
    const projectRoot = tempProject(`
// import { test } from "bun:test";
const text = 'import "node:fs"';
export const ok = true;
`);
    const files = discoverSourceFiles(projectRoot).files;
    const analysis = analyzeImports(files);

    expect(analysis.imports).toEqual([]);
  });
});
