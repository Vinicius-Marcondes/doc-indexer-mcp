import { describe, expect, test } from "bun:test";
import { normalizeRecommendationToFinding } from "../../../src/recommendations/finding-normalizer";
import type { Recommendation } from "../../../src/shared/contracts";

const projectHash = "f".repeat(64);

function recommendation(overrides: Partial<Recommendation> = {}): Recommendation {
  return {
    id: "missing-types-bun-package",
    severity: "warning",
    title: "Add @types/bun for Bun API usage",
    detail: "The project uses Bun globals but package.json does not include @types/bun.",
    evidence: ["Detected Bun.serve at src/index.ts:1"],
    sources: ["https://bun.com/docs/runtime/typescript", "local-project:package.json"],
    recommendedAction: "Run bun add -d @types/bun before relying on Bun global types.",
    ...overrides
  };
}

describe("finding normalizer", () => {
  test("missing @types/bun recommendation becomes a warning finding", () => {
    const finding = normalizeRecommendationToFinding(recommendation(), {
      projectHash,
      citationIdsBySource: {
        "https://bun.com/docs/runtime/typescript": "c1",
        "local-project:package.json": "local-package-json"
      }
    });

    expect(finding).toMatchObject({
      id: "missing-types-bun-package",
      ruleId: "missing-types-bun-package",
      framework: "bun",
      severity: "warning",
      title: "Add @types/bun for Bun API usage",
      message: "The project uses Bun globals but package.json does not include @types/bun.",
      evidence: ["Detected Bun.serve at src/index.ts:1"],
      citationIds: ["c1", "local-package-json"]
    });
    expect(finding.fingerprint).toHaveLength(64);
  });

  test("mixed lockfiles recommendation becomes a warning finding", () => {
    const finding = normalizeRecommendationToFinding(
      recommendation({
        id: "mixed-lockfiles",
        title: "Resolve mixed package-manager lockfiles",
        detail: "Multiple package-manager lockfiles were found.",
        evidence: ["Found bun.lock", "Found package-lock.json"],
        sources: ["https://bun.com/docs/pm/lockfile", "local-project:package-lock.json"]
      }),
      {
        projectHash,
        citationIdsBySource: {
          "https://bun.com/docs/pm/lockfile": "c-lockfile",
          "local-project:package-lock.json": "local-package-lock-json"
        }
      }
    );

    expect(finding.severity).toBe("warning");
    expect(finding.ruleId).toBe("mixed-lockfiles");
    expect(finding.evidence).toEqual(["Found bun.lock", "Found package-lock.json"]);
    expect(finding.citationIds).toEqual(["c-lockfile", "local-package-lock-json"]);
  });

  test("evidence and citation IDs are preserved", () => {
    const finding = normalizeRecommendationToFinding(recommendation(), {
      projectHash,
      citationIdsBySource: {
        "https://bun.com/docs/runtime/typescript": "bun-typescript-docs",
        "local-project:package.json": "local-package-json"
      }
    });

    expect(finding.evidence).toEqual(recommendation().evidence);
    expect(finding.citationIds).toEqual(["bun-typescript-docs", "local-package-json"]);
  });

  test("fingerprints are stable for identical input", () => {
    const first = normalizeRecommendationToFinding(recommendation(), { projectHash });
    const second = normalizeRecommendationToFinding(recommendation(), { projectHash });

    expect(first.fingerprint).toBe(second.fingerprint);
  });

  test("fingerprints change when evidence changes", () => {
    const first = normalizeRecommendationToFinding(recommendation(), { projectHash });
    const second = normalizeRecommendationToFinding(
      recommendation({ evidence: ["Detected Bun.file at src/file.ts:2"] }),
      { projectHash }
    );

    expect(first.fingerprint).not.toBe(second.fingerprint);
  });
});
