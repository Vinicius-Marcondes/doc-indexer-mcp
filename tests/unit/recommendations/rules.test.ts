import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeBunGlobals } from "../../../src/analyzers/ast-bun-globals";
import { analyzeLockfiles } from "../../../src/analyzers/lockfiles";
import { parsePackageJson } from "../../../src/analyzers/package-json";
import { discoverSourceFiles } from "../../../src/analyzers/source-discovery";
import { analyzeTests } from "../../../src/analyzers/test-analysis";
import { parseTsconfig } from "../../../src/analyzers/tsconfig";
import { createDependencyPlan } from "../../../src/recommendations/dependency-plan";
import { generateProjectRecommendations } from "../../../src/recommendations/rules";
import type { NpmPackageMetadata } from "../../../src/sources/npm-registry";

const testDir = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(testDir, "../../fixtures/projects");
const tempDirs: string[] = [];

function tempProject(files: Record<string, string>): string {
  const dir = mkdtempSync(resolve(tmpdir(), "bun-dev-intel-rules-"));
  tempDirs.push(dir);

  for (const [path, content] of Object.entries(files)) {
    const filePath = resolve(dir, path);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content);
  }

  return dir;
}

function recommendationsFor(projectRoot: string) {
  const files = discoverSourceFiles(projectRoot).files;
  const packageResult = parsePackageJson(projectRoot);
  const tsconfigResult = parseTsconfig(projectRoot);

  if (!packageResult.ok || !tsconfigResult.ok) {
    throw new Error("test fixture did not parse");
  }

  return generateProjectRecommendations({
    packageJson: packageResult.packageJson,
    tsconfig: tsconfigResult.tsconfig,
    lockfiles: analyzeLockfiles(projectRoot),
    bunGlobals: analyzeBunGlobals(files),
    testAnalysis: analyzeTests(projectRoot)
  });
}

function metadata(overrides: Partial<NpmPackageMetadata> = {}): NpmPackageMetadata {
  return {
    name: "fixture-lib",
    sourceUrl: "https://registry.npmjs.org/fixture-lib",
    fetchedAt: "2026-05-12T10:00:00.000Z",
    distTags: { latest: "1.0.0" },
    latestVersion: "1.0.0",
    versions: {
      "1.0.0": {
        version: "1.0.0",
        deprecated: "Use another package",
        peerDependencies: { react: "^18.0.0" },
        engines: { bun: ">=2.0.0" }
      }
    },
    deprecations: [{ version: "1.0.0", message: "Use another package" }],
    time: {},
    ...overrides
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("recommendation rules", () => {
  test("fires for missing @types/bun when Bun APIs are used", () => {
    const projectRoot = tempProject({
      "package.json": JSON.stringify({ type: "module", devDependencies: { typescript: "^5.9.0" } }),
      "tsconfig.json": JSON.stringify({ compilerOptions: { moduleResolution: "bundler" } }),
      "src/index.ts": "Bun.serve({ fetch: () => new Response('ok') });"
    });

    expect(recommendationsFor(projectRoot).map((recommendation) => recommendation.id)).toContain("missing-types-bun-package");
  });

  test("fires for missing types bun when Bun types are needed", () => {
    const projectRoot = tempProject({
      "package.json": JSON.stringify({ type: "module", devDependencies: { "@types/bun": "^1.3.0" } }),
      "tsconfig.json": JSON.stringify({ compilerOptions: { moduleResolution: "bundler" } }),
      "src/index.ts": "Bun.serve({ fetch: () => new Response('ok') });"
    });

    expect(recommendationsFor(projectRoot).map((recommendation) => recommendation.id)).toContain("missing-tsconfig-bun-types");
  });

  test("fires for Bun-relevant compiler options missing or divergent", () => {
    const projectRoot = tempProject({
      "package.json": JSON.stringify({ type: "module", devDependencies: { "@types/bun": "^1.3.0" } }),
      "tsconfig.json": JSON.stringify({ compilerOptions: { types: ["bun"], moduleResolution: "node16" } }),
      "src/index.ts": "Bun.serve({ fetch: () => new Response('ok') });"
    });

    expect(recommendationsFor(projectRoot).map((recommendation) => recommendation.id)).toContain(
      "bun-typescript-compiler-options"
    );
  });

  test("fires for legacy bun.lockb", () => {
    expect(recommendationsFor(resolve(fixturesDir, "legacy-lockb")).map((recommendation) => recommendation.id)).toContain(
      "legacy-bun-lockb"
    );
  });

  test("fires for mixed lockfiles", () => {
    expect(recommendationsFor(resolve(fixturesDir, "mixed-lockfiles")).map((recommendation) => recommendation.id)).toContain(
      "mixed-lockfiles"
    );
  });

  test("fires for missing Bun test script when bun:test is present", () => {
    const projectRoot = tempProject({
      "package.json": JSON.stringify({ type: "module" }),
      "tests/math.test.ts": 'import { test } from "bun:test"; test("ok", () => {});'
    });

    expect(recommendationsFor(projectRoot).map((recommendation) => recommendation.id)).toContain("bun-test-missing-script");
  });

  test("does not fire for a compliant fixture", () => {
    expect(recommendationsFor(resolve(fixturesDir, "minimal-bun-ts"))).toEqual([]);
  });

  test("includes Bun-native dependency plan recommendations and metadata warnings", () => {
    const plan = createDependencyPlan({
      dependencyType: "dependencies",
      packages: [{ name: "fixture-lib", metadata: metadata() }]
    });

    expect(plan.recommendations.map((recommendation) => recommendation.id)).toContain("bun-native-install-command");
    expect(plan.deprecationWarnings).toHaveLength(1);
    expect(plan.peerDependencyWarnings).toHaveLength(1);
    expect(plan.engineWarnings).toHaveLength(1);
  });

  test("every recommendation has required evidence and source references", () => {
    const projectRoot = tempProject({
      "package.json": JSON.stringify({ type: "module" }),
      "tsconfig.json": JSON.stringify({ compilerOptions: { moduleResolution: "node16" } }),
      "src/index.ts": "Bun.serve({ fetch: () => new Response('ok') });",
      "bun.lockb": "legacy"
    });

    for (const recommendation of recommendationsFor(projectRoot)) {
      expect(typeof recommendation.id).toBe("string");
      expect(recommendation.severity).toMatch(/^(info|warning|error)$/);
      expect(recommendation.title.length).toBeGreaterThan(0);
      expect(recommendation.detail.length).toBeGreaterThan(0);
      expect(recommendation.evidence.length).toBeGreaterThan(0);
      expect(recommendation.sources.length).toBeGreaterThan(0);
    }
  });

  test("recommendations are stable in sorted order", () => {
    const projectRoot = tempProject({
      "package.json": JSON.stringify({ type: "module" }),
      "tsconfig.json": JSON.stringify({ compilerOptions: { moduleResolution: "node16" } }),
      "src/index.ts": "Bun.serve({ fetch: () => new Response('ok') });",
      "bun.lockb": "legacy"
    });
    const ids = recommendationsFor(projectRoot).map((recommendation) => recommendation.id);

    expect(ids).toEqual([...ids].sort());
  });
});
