import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { readTextFileIfAllowed, shouldIgnorePath } from "../../../src/security/ignore-policy";

describe("ignore policy", () => {
  test("skips node_modules directories", () => {
    const decision = shouldIgnorePath(resolve("fixture", "node_modules"), "directory");

    expect(decision.ignored).toBe(true);
    expect(decision.reason).toBe("ignored_directory");
    expect(decision.label).toBe("node_modules");
  });

  test("skips build, cache, and coverage directories", () => {
    for (const dirName of ["dist", "build", ".cache", "coverage", ".turbo", ".next", ".expo"] as const) {
      const decision = shouldIgnorePath(resolve("fixture", dirName), "directory");

      expect(decision.ignored).toBe(true);
      expect(decision.reason).toBe("ignored_directory");
      expect(decision.label).toBe(dirName);
    }
  });

  test("skips secret-like files", () => {
    for (const fileName of [".env", ".env.local", ".env.production", "private.key", "credentials.json"] as const) {
      const decision = shouldIgnorePath(resolve("fixture", fileName), "file");

      expect(decision.ignored).toBe(true);
      expect(decision.reason).toBe("secret_file");
      expect(decision.label).toBe(fileName);
    }
  });

  test("skips binary-looking files", () => {
    for (const fileName of ["bun.lockb", "image.png", "archive.zip", "native.node", "data.sqlite"] as const) {
      const decision = shouldIgnorePath(resolve("fixture", fileName), "file");

      expect(decision.ignored).toBe(true);
      expect(decision.reason).toBe("binary_file");
      expect(decision.label).toBe(fileName);
    }
  });

  test("does not open skipped files in the guarded reader", () => {
    let opened = false;
    const result = readTextFileIfAllowed(resolve("fixture", ".env"), () => {
      opened = true;
      return "SECRET=value";
    });

    expect(opened).toBe(false);
    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.skipped.reason).toBe("secret_file");
    }
  });

  test("opens allowed text files in the guarded reader", () => {
    let opened = false;
    const result = readTextFileIfAllowed(resolve("fixture", "src/index.ts"), () => {
      opened = true;
      return "export const value = true;";
    });

    expect(opened).toBe(true);
    expect(result).toEqual({
      ok: true,
      content: "export const value = true;"
    });
  });
});
