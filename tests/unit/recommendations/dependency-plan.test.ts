import { describe, expect, test } from "bun:test";
import { createDependencyPlan } from "../../../src/recommendations/dependency-plan";
import type { NpmPackageMetadata } from "../../../src/sources/npm-registry";

function metadata(overrides: Partial<NpmPackageMetadata> = {}): NpmPackageMetadata {
  return {
    name: "fixture-lib",
    sourceUrl: "https://registry.npmjs.org/fixture-lib",
    fetchedAt: "2026-05-12T10:00:00.000Z",
    distTags: {
      latest: "2.0.0"
    },
    latestVersion: "2.0.0",
    versions: {
      "1.0.0": {
        version: "1.0.0",
        deprecated: "Use 2.x",
        peerDependencies: {},
        engines: {},
        publishedAt: "2024-01-01T00:00:00.000Z"
      },
      "2.0.0": {
        version: "2.0.0",
        peerDependencies: {},
        engines: {},
        publishedAt: "2026-01-01T00:00:00.000Z"
      }
    },
    deprecations: [
      {
        version: "1.0.0",
        message: "Use 2.x"
      }
    ],
    time: {
      "1.0.0": "2024-01-01T00:00:00.000Z",
      "2.0.0": "2026-01-01T00:00:00.000Z"
    },
    ...overrides
  };
}

describe("dependency plan recommendations", () => {
  test("runtime dependency returns bun add", () => {
    const plan = createDependencyPlan({
      dependencyType: "dependencies",
      packages: [{ name: "fixture-lib", metadata: metadata() }]
    });

    expect(plan.installCommand).toBe("bun add fixture-lib");
    expect(plan.recommendations[0]?.recommendedAction).toBe("bun add fixture-lib");
  });

  test("dev dependency returns bun add -d", () => {
    const plan = createDependencyPlan({
      dependencyType: "devDependencies",
      packages: [{ name: "typescript", metadata: metadata({ name: "typescript", sourceUrl: "https://registry.npmjs.org/typescript" }) }]
    });

    expect(plan.installCommand).toBe("bun add -d typescript");
  });

  test("requested version range is preserved", () => {
    const plan = createDependencyPlan({
      dependencyType: "dependencies",
      packages: [{ name: "fixture-lib", requestedRange: "^1.0.0", metadata: metadata() }]
    });

    expect(plan.installCommand).toBe("bun add fixture-lib@^1.0.0");
    expect(plan.packages[0]).toEqual({
      name: "fixture-lib",
      requestedRange: "^1.0.0",
      selectedVersion: "2.0.0"
    });
  });

  test("deprecation warning is included", () => {
    const plan = createDependencyPlan({
      dependencyType: "dependencies",
      packages: [{ name: "fixture-lib", requestedRange: "1.0.0", metadata: metadata() }]
    });

    expect(plan.deprecationWarnings).toHaveLength(1);
    expect(plan.deprecationWarnings[0]?.detail).toContain("Use 2.x");
    expect(plan.deprecationWarnings[0]?.evidence).toContain("fixture-lib@1.0.0 is deprecated: Use 2.x");
  });

  test("peer dependency warning is included", () => {
    const plan = createDependencyPlan({
      dependencyType: "dependencies",
      packages: [
        {
          name: "fixture-lib",
          metadata: metadata({
            versions: {
              "2.0.0": {
                version: "2.0.0",
                peerDependencies: {
                  react: "^18.0.0"
                },
                engines: {}
              }
            }
          })
        }
      ]
    });

    expect(plan.peerDependencyWarnings).toHaveLength(1);
    expect(plan.peerDependencyWarnings[0]?.detail).toContain("react@^18.0.0");
  });

  test("engine warning is included", () => {
    const plan = createDependencyPlan({
      dependencyType: "dependencies",
      packages: [
        {
          name: "fixture-lib",
          metadata: metadata({
            versions: {
              "2.0.0": {
                version: "2.0.0",
                peerDependencies: {},
                engines: {
                  bun: ">=2.0.0"
                }
              }
            }
          })
        }
      ]
    });

    expect(plan.engineWarnings).toHaveLength(1);
    expect(plan.engineWarnings[0]?.detail).toContain("bun@>=2.0.0");
  });

  test("npm, yarn, and pnpm commands are not recommended for Bun-first projects", () => {
    const plan = createDependencyPlan({
      dependencyType: "dependencies",
      packages: [{ name: "fixture-lib", metadata: metadata() }]
    });

    expect(plan.installCommand).not.toContain("npm install");
    expect(plan.installCommand).not.toContain("yarn add");
    expect(plan.installCommand).not.toContain("pnpm add");
    expect(plan.recommendations.flatMap((recommendation) => recommendation.evidence)).toContain(
      "Bun-native dependency command selected for a Bun-first project."
    );
  });
});
