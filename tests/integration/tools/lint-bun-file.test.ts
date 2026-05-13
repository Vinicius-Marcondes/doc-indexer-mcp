import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateAgentResponseEnvelope } from "../../../src/shared/agent-output";
import { lintBunFile } from "../../../src/tools/lint-bun-file";

const testDir = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(testDir, "../../fixtures/projects");
const tempDirs: string[] = [];

function validateEnvelopePortion(result: Extract<ReturnType<typeof lintBunFile>, { ok: true }>): void {
  const { filePath: _filePath, fileFacts: _fileFacts, ...envelope } = result;
  validateAgentResponseEnvelope(envelope);
}

function outsideFile(): string {
  const dir = mkdtempSync(resolve(tmpdir(), "bun-dev-intel-lint-outside-"));
  tempDirs.push(dir);
  const path = resolve(dir, "outside.ts");
  writeFileSync(path, "Bun.serve({ fetch: () => new Response('ok') });");
  return path;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("lint_bun_file tool", () => {
  test("file with Bun.serve returns Bun API and type-related findings", () => {
    const result = lintBunFile({
      projectPath: resolve(fixturesDir, "missing-bun-types"),
      filePath: "src/index.ts"
    });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.findings.map((finding) => finding.ruleId)).toEqual(
        expect.arrayContaining(["bun-global-usage", "missing-types-bun-package"])
      );
      expect(result.findings.some((finding) => finding.locations.some((location) => location.line === 1))).toBe(true);
      validateEnvelopePortion(result);
    }
  });

  test("file importing bun:test returns test-related findings", () => {
    const result = lintBunFile({
      projectPath: resolve(fixturesDir, "bun-test"),
      filePath: "tests/math.test.ts"
    });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.findings.map((finding) => finding.ruleId)).toContain("bun-test-import");
    }
  });

  test("path outside project fails", () => {
    const result = lintBunFile({
      projectPath: resolve(fixturesDir, "minimal-bun-ts"),
      filePath: outsideFile()
    });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe("unsafe_path");
    }
  });

  test("node_modules path fails before reading", () => {
    const result = lintBunFile({
      projectPath: resolve(fixturesDir, "minimal-bun-ts"),
      filePath: "node_modules/pkg/index.ts"
    });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe("unsafe_path");
      expect(result.error.details?.reason).toBe("ignored_directory");
    }
  });

  test("secret-like file path fails", () => {
    const result = lintBunFile({
      projectPath: resolve(fixturesDir, "minimal-bun-ts"),
      filePath: ".env"
    });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe("unsafe_path");
      expect(result.error.details?.reason).toBe("secret_file");
    }
  });

  test("brief mode returns only file-relevant findings", () => {
    const result = lintBunFile({
      projectPath: resolve(fixturesDir, "missing-bun-types"),
      filePath: "src/index.ts",
      responseMode: "brief"
    });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.responseMode).toBe("brief");
      expect(result.findings.length).toBeLessThanOrEqual(3);
      expect(result.findings.every((finding) => finding.locations.length === 0 || finding.locations[0]?.filePath === "src/index.ts")).toBe(
        true
      );
    }
  });
});
