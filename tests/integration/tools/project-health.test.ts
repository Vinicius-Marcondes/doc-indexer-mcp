import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateAgentResponseEnvelope } from "../../../src/shared/agent-output";
import { projectHealth } from "../../../src/tools/project-health";

const testDir = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(testDir, "../../fixtures/projects");
const tempDirs: string[] = [];

function validateEnvelopePortion(result: Extract<ReturnType<typeof projectHealth>, { ok: true }>): void {
  const { projectProfile: _projectProfile, ...envelope } = result;
  validateAgentResponseEnvelope(envelope);
}

function tempBunApiProject(source: string): string {
  const dir = mkdtempSync(resolve(tmpdir(), "bun-dev-intel-project-health-delta-"));
  tempDirs.push(dir);
  mkdirSync(resolve(dir, "src"), { recursive: true });
  writeFileSync(resolve(dir, "package.json"), JSON.stringify({ name: "delta-project", type: "module" }));
  writeFileSync(
    resolve(dir, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { target: "ESNext", module: "Preserve", moduleResolution: "bundler", noEmit: true } })
  );
  writeFileSync(resolve(dir, "src/index.ts"), source);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("project_health tool", () => {
  test("defaults to brief mode", () => {
    const result = projectHealth({ projectPath: resolve(fixturesDir, "minimal-bun-ts") });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.responseMode).toBe("brief");
      validateEnvelopePortion(result);
    }
  });

  test("brief summary is within 500 characters", () => {
    const result = projectHealth({ projectPath: resolve(fixturesDir, "mixed-lockfiles") });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.summary.length).toBeLessThanOrEqual(500);
    }
  });

  test("mixed lockfiles fixture returns a ranked lockfile finding", () => {
    const result = projectHealth({ projectPath: resolve(fixturesDir, "mixed-lockfiles"), focus: "lockfile" });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.findings[0]?.id).toBe("mixed-lockfiles");
      expect(result.findings[0]?.citationIds.length).toBeGreaterThan(0);
      validateEnvelopePortion(result);
    }
  });

  test("TypeScript focus returns TypeScript-specific findings", () => {
    const result = projectHealth({ projectPath: resolve(fixturesDir, "missing-bun-types"), focus: "typescript" });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.findings.map((finding) => finding.id)).toEqual(
        expect.arrayContaining(["missing-types-bun-package", "missing-tsconfig-bun-types"])
      );
      expect(result.findings.every((finding) => /typescript|tsconfig|types-bun|bun-types/u.test(finding.id))).toBe(true);
    }
  });

  test("full mode includes a detail resource", () => {
    const result = projectHealth({ projectPath: resolve(fixturesDir, "minimal-bun-ts"), responseMode: "full" });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.responseMode).toBe("full");
      expect(result.detailResource).toBe(`bun-project://analysis/${result.projectHash}`);
    }
  });

  test("recommended validation commands are actions and are not executed", () => {
    const result = projectHealth({ projectPath: resolve(fixturesDir, "bun-test"), focus: "tests" });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.actions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "verify",
            command: "bun test",
            requiresApproval: true
          })
        ])
      );
      expect(result.summary).not.toContain("executed");
    }
  });

  test("first call returns a delta token", () => {
    const result = projectHealth({ projectPath: resolve(fixturesDir, "mixed-lockfiles") });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.deltaToken).toBeTypeOf("string");
    }
  });

  test("second call with unchanged project returns repeated IDs", () => {
    const first = projectHealth({ projectPath: resolve(fixturesDir, "mixed-lockfiles"), focus: "lockfile" });

    expect(first.ok).toBe(true);

    if (first.ok) {
      const second = projectHealth({
        projectPath: resolve(fixturesDir, "mixed-lockfiles"),
        focus: "lockfile",
        sinceToken: first.deltaToken
      });

      expect(second.ok).toBe(true);

      if (second.ok) {
        expect(second.delta?.repeatedFindingIds).toContain("mixed-lockfiles");
      }
    }
  });

  test("changed file produces changed finding IDs", () => {
    const projectPath = tempBunApiProject("export const server = Bun.serve({ fetch: () => new Response('ok') });");
    const first = projectHealth({ projectPath, focus: "typescript" });

    expect(first.ok).toBe(true);

    if (first.ok) {
      writeFileSync(resolve(projectPath, "src/index.ts"), "export const file = Bun.file('fixture.txt');");
      const second = projectHealth({ projectPath, focus: "typescript", sinceToken: first.deltaToken });

      expect(second.ok).toBe(true);

      if (second.ok) {
        expect(second.delta?.changedFindingIds).toEqual(expect.arrayContaining(["missing-types-bun-package"]));
      }
    }
  });

  test("resolved issue appears in resolved IDs", () => {
    const projectPath = tempBunApiProject("export const server = Bun.serve({ fetch: () => new Response('ok') });");
    const first = projectHealth({ projectPath, focus: "typescript" });

    expect(first.ok).toBe(true);

    if (first.ok) {
      writeFileSync(resolve(projectPath, "src/index.ts"), "export const value = 1;");
      const second = projectHealth({ projectPath, focus: "typescript", sinceToken: first.deltaToken });

      expect(second.ok).toBe(true);

      if (second.ok) {
        expect(second.delta?.resolvedFindingIds).toEqual(expect.arrayContaining(["missing-types-bun-package"]));
      }
    }
  });

  test("invalid token produces warning and current response", () => {
    const result = projectHealth({
      projectPath: resolve(fixturesDir, "mixed-lockfiles"),
      focus: "lockfile",
      sinceToken: "invalid-token"
    });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.warnings.map((warning) => warning.id)).toContain("delta-token-invalid");
      expect(result.findings.map((finding) => finding.id)).toContain("mixed-lockfiles");
    }
  });
});
