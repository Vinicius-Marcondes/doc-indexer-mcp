import { describe, expect, test } from "bun:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeLockfiles } from "../../../src/analyzers/lockfiles";

const testDir = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(testDir, "../../fixtures/projects");

describe("lockfile analyzer", () => {
  test("detects bun.lock", () => {
    const analysis = analyzeLockfiles(resolve(fixturesDir, "minimal-bun-ts"));

    expect(analysis.lockfiles.bunLock).toBe(true);
    expect(analysis.lockfiles.present).toContain("bun.lock");
  });

  test("detects legacy bun.lockb", () => {
    const analysis = analyzeLockfiles(resolve(fixturesDir, "legacy-lockb"));

    expect(analysis.lockfiles.bunLockb).toBe(true);
    expect(analysis.lockfiles.present).toContain("bun.lockb");
  });

  test("detects npm, pnpm, and yarn lockfiles", () => {
    const analysis = analyzeLockfiles(resolve(fixturesDir, "mixed-lockfiles"));

    expect(analysis.lockfiles.packageLock).toBe(true);
    expect(analysis.lockfiles.pnpmLock).toBe(true);
    expect(analysis.lockfiles.yarnLock).toBe(true);
    expect(analysis.lockfiles.foreign).toEqual(["package-lock.json", "pnpm-lock.yaml", "yarn.lock"]);
  });

  test("classifies Bun-first project", () => {
    const analysis = analyzeLockfiles(resolve(fixturesDir, "minimal-bun-ts"));

    expect(analysis.packageManager).toEqual({
      name: "bun",
      confidence: "high"
    });
  });

  test("warns on mixed lockfiles", () => {
    const analysis = analyzeLockfiles(resolve(fixturesDir, "mixed-lockfiles"));

    expect(analysis.packageManager).toEqual({
      name: "bun",
      confidence: "medium"
    });
    expect(analysis.warnings).toHaveLength(1);
    expect(analysis.warnings[0]?.title).toContain("Mixed lockfiles");
    expect(analysis.warnings[0]?.evidence).toEqual([
      "Found bun.lock",
      "Found package-lock.json",
      "Found pnpm-lock.yaml",
      "Found yarn.lock"
    ]);
  });

  test("does not read lockfile contents unnecessarily", () => {
    const seen: string[] = [];
    const analysis = analyzeLockfiles("/project", {
      exists: (path) => {
        seen.push(path);
        return path.endsWith("bun.lock") || path.endsWith("bun.lockb");
      }
    });

    expect(analysis.lockfiles.present).toEqual(["bun.lock", "bun.lockb"]);
    expect(seen.map((path) => path.split("/").at(-1))).toEqual([
      "bun.lock",
      "bun.lockb",
      "package-lock.json",
      "pnpm-lock.yaml",
      "yarn.lock"
    ]);
  });
});
