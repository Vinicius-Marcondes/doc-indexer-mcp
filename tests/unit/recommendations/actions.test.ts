import { describe, expect, test } from "bun:test";
import {
  createActionFromRecommendation,
  createVerifyAction
} from "../../../src/recommendations/actions";
import { normalizeRecommendationToFinding } from "../../../src/recommendations/finding-normalizer";
import type { Recommendation } from "../../../src/shared/contracts";

const projectHash = "a".repeat(64);

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

describe("structured recommendation actions", () => {
  test("bun add -d @types/bun becomes a command action with approval required", () => {
    const input = recommendation();
    const finding = normalizeRecommendationToFinding(input, {
      projectHash,
      citationIdsBySource: {
        "https://bun.com/docs/runtime/typescript": "c1",
        "local-project:package.json": "local-package-json"
      }
    });
    const action = createActionFromRecommendation(input, finding);

    expect(action).toMatchObject({
      id: "action-missing-types-bun-package",
      kind: "command",
      command: "bun add -d @types/bun",
      requiresApproval: true,
      citationIds: ["c1", "local-package-json"],
      relatedFindingIds: ["missing-types-bun-package"]
    });
  });

  test("lockfile cleanup is medium or high risk and approval-gated", () => {
    const input = recommendation({
      id: "legacy-bun-lockb",
      title: "Migrate legacy bun.lockb",
      detail: "Only the legacy binary Bun lockfile was found.",
      evidence: ["Found bun.lockb"],
      sources: ["https://bun.com/docs/pm/lockfile", "local-project:bun.lockb"],
      recommendedAction: "Regenerate the current text bun.lock with Bun when the user approves dependency maintenance."
    });
    const finding = normalizeRecommendationToFinding(input, { projectHash });
    const action = createActionFromRecommendation(input, finding);

    expect(action).not.toBeNull();
    expect(action!.kind).toBe("manual");
    expect(action!.requiresApproval).toBe(true);
    expect(["medium", "high"]).toContain(action!.risk);
  });

  test("verification commands are verify actions and are not executed", () => {
    const action = createVerifyAction({
      id: "verify-typecheck",
      title: "Run typecheck",
      command: "bun run typecheck",
      reason: "Confirm TypeScript config changes are valid.",
      citationIds: ["local-package-json"],
      relatedFindingIds: ["missing-tsconfig-bun-types"]
    });

    expect(action).toMatchObject({
      kind: "verify",
      command: "bun run typecheck",
      requiresApproval: true,
      risk: "low"
    });
  });
});
