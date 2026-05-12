import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseBunfig } from "../../../src/analyzers/bunfig";

const testDir = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(testDir, "../../fixtures/projects");
const tempDirs: string[] = [];

function tempProject(bunfig: string): string {
  const dir = mkdtempSync(resolve(tmpdir(), "bun-dev-intel-bunfig-"));
  tempDirs.push(dir);
  writeFileSync(resolve(dir, "bunfig.toml"), bunfig);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("bunfig analyzer", () => {
  test("detects missing bunfig", () => {
    const result = parseBunfig(resolve(fixturesDir, "minimal-bun-ts"));

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.bunfig.exists).toBe(false);
      expect(result.bunfig.settings).toEqual({});
      expect(result.bunfig.warnings).toEqual([]);
    }
  });

  test("parses a simple valid bunfig fixture", () => {
    const projectDir = tempProject(`
[install]
registry = "https://registry.npmjs.org/"
exact = true

[test]
preload = ["./setup.ts", "./env.ts"]
`);

    const result = parseBunfig(projectDir);

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.bunfig.exists).toBe(true);
      expect(result.bunfig.settings).toEqual({
        install: {
          registry: "https://registry.npmjs.org/",
          exact: true
        },
        test: {
          preload: ["./setup.ts", "./env.ts"]
        }
      });
    }
  });

  test("reports malformed bunfig", () => {
    const projectDir = tempProject(`
[install]
registry = "https://registry.npmjs.org/"
secret_token should-not-leak
`);

    const result = parseBunfig(projectDir);

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.bunfig.warnings).toHaveLength(1);
      expect(result.bunfig.warnings[0]?.id).toBe("bunfig-malformed-line");
      expect(result.bunfig.warnings[0]?.evidence).toEqual(["bunfig.toml line 4 is malformed"]);
      expect(JSON.stringify(result.bunfig.warnings)).not.toContain("should-not-leak");
    }
  });

  test("includes file evidence without leaking unrelated content", () => {
    const projectDir = tempProject(`
api_key = "should-not-leak"
malformed token
`);

    const result = parseBunfig(projectDir);

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.bunfig.path.endsWith("bunfig.toml")).toBe(true);
      expect(JSON.stringify(result.bunfig)).not.toContain("malformed token");
    }
  });
});
