import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePathWithinProject, resolveProjectRoot } from "../../../src/security/project-paths";

const testDir = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = resolve(testDir, "../../fixtures/projects/minimal-bun-ts");

describe("safe project path handling", () => {
  test("accepts a valid fixture project path", () => {
    const result = resolveProjectRoot(fixtureRoot);

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.projectRoot).toBe(resolve(fixtureRoot));
      expect(result.realProjectRoot).toBe(resolve(fixtureRoot));
    }
  });

  test("rejects missing paths", () => {
    const result = resolveProjectRoot(resolve(fixtureRoot, "missing"));

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe("unsafe_path");
      expect(result.error.message).toContain("does not exist");
    }
  });

  test("rejects file paths when a directory is required", () => {
    const result = resolveProjectRoot(resolve(fixtureRoot, "package.json"));

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe("unsafe_path");
      expect(result.error.message).toContain("directory");
    }
  });

  test("rejects traversal attempts outside the project root", () => {
    const rootResult = resolveProjectRoot(fixtureRoot);
    expect(rootResult.ok).toBe(true);

    if (rootResult.ok) {
      const result = resolvePathWithinProject(rootResult, "../manifest.md");

      expect(result.ok).toBe(false);

      if (!result.ok) {
        expect(result.error.code).toBe("unsafe_path");
        expect(result.error.message).toContain("outside");
      }
    }
  });

  test("rejects symlinks that escape the fixture root when symlink support is present", () => {
    const tempRoot = mkdtempSync(resolve(tmpdir(), "bun-dev-intel-path-"));
    const externalFile = resolve(tempRoot, "external.txt");
    const projectDir = resolve(tempRoot, "project");
    const linkPath = resolve(projectDir, "linked-external.txt");

    mkdirSync(projectDir);
    writeFileSync(externalFile, "outside");
    writeFileSync(resolve(projectDir, "package.json"), "{\"type\":\"module\"}", { flag: "wx" });

    if (!existsSync(linkPath)) {
      symlinkSync(externalFile, linkPath);
    }

    const rootResult = resolveProjectRoot(projectDir);
    expect(rootResult.ok).toBe(true);

    if (rootResult.ok) {
      const result = resolvePathWithinProject(rootResult, "linked-external.txt");

      expect(result.ok).toBe(false);

      if (!result.ok) {
        expect(result.error.code).toBe("unsafe_path");
        expect(result.error.message).toContain("outside");
      }
    }
  });
});
