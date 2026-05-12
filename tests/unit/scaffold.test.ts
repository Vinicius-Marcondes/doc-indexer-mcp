import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const rootDir = resolve(import.meta.dir, "../..");

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("project scaffold", () => {
  test("defines the expected Bun package scripts", () => {
    const packagePath = resolve(rootDir, "package.json");

    expect(existsSync(packagePath)).toBe(true);

    const packageJson = readJson(packagePath) as {
      scripts?: Record<string, string>;
      type?: string;
    };

    expect(packageJson.type).toBe("module");
    expect(packageJson.scripts?.test).toBe("bun test");
    expect(packageJson.scripts?.typecheck).toContain("tsc");
    expect(packageJson.scripts?.typecheck).toContain("--noEmit");
    expect(packageJson.scripts?.check).toContain("bun test");
    expect(packageJson.scripts?.check).toContain("bun run typecheck");
    expect(packageJson.scripts?.dev).toContain("bun");
  });

  test("provides a parseable Bun-compatible tsconfig", () => {
    const tsconfigPath = resolve(rootDir, "tsconfig.json");

    expect(existsSync(tsconfigPath)).toBe(true);

    const tsconfig = readJson(tsconfigPath) as {
      compilerOptions?: Record<string, unknown>;
      include?: string[];
      exclude?: string[];
    };

    expect(tsconfig.compilerOptions?.target).toBe("ESNext");
    expect(tsconfig.compilerOptions?.module).toBe("Preserve");
    expect(tsconfig.compilerOptions?.moduleResolution).toBe("bundler");
    expect(tsconfig.compilerOptions?.types).toEqual(["bun"]);
    expect(tsconfig.compilerOptions?.noEmit).toBe(true);
    expect(tsconfig.include).toEqual(expect.arrayContaining(["src/**/*.ts", "tests/**/*.ts"]));
    expect(tsconfig.exclude).toEqual(expect.arrayContaining(["tests/fixtures/projects/**"]));
  });

  test("creates source and test directories", () => {
    expect(existsSync(resolve(rootDir, "src"))).toBe(true);
    expect(existsSync(resolve(rootDir, "src/tools"))).toBe(true);
    expect(existsSync(resolve(rootDir, "src/resources"))).toBe(true);
    expect(existsSync(resolve(rootDir, "src/analyzers"))).toBe(true);
    expect(existsSync(resolve(rootDir, "src/sources"))).toBe(true);
    expect(existsSync(resolve(rootDir, "src/cache"))).toBe(true);
    expect(existsSync(resolve(rootDir, "src/shared"))).toBe(true);
    expect(existsSync(resolve(rootDir, "tests/unit"))).toBe(true);
    expect(existsSync(resolve(rootDir, "tests/integration"))).toBe(true);
    expect(existsSync(resolve(rootDir, "tests/fixtures"))).toBe(true);
  });
});
