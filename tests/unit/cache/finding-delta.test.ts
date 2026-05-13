import { describe, expect, test } from "bun:test";
import { FindingDeltaStore } from "../../../src/cache/finding-delta";
import type { AgentFinding } from "../../../src/shared/agent-output";

function finding(id: string, fingerprint: string, severity: AgentFinding["severity"] = "warning"): AgentFinding {
  return {
    id,
    ruleId: id,
    framework: "bun",
    severity,
    title: id,
    message: `${id} message`,
    evidence: [`${id} evidence`],
    locations: [],
    citationIds: ["c1"],
    fingerprint
  };
}

describe("finding delta store", () => {
  test("valid token returns new, changed, resolved, and repeated IDs", () => {
    const store = new FindingDeltaStore();
    const token = store.createToken([finding("a", "fp-a"), finding("b", "fp-b")]);
    const result = store.compare(token, [finding("a", "fp-a"), finding("b", "fp-b2"), finding("c", "fp-c")]);

    expect(result.valid).toBe(true);

    if (result.valid) {
      expect(result.delta).toEqual({
        sinceToken: token,
        newFindingIds: ["c"],
        changedFindingIds: ["b"],
        resolvedFindingIds: [],
        repeatedFindingIds: ["a"]
      });
    }
  });

  test("resolved issue appears in resolved IDs", () => {
    const store = new FindingDeltaStore();
    const token = store.createToken([finding("a", "fp-a"), finding("b", "fp-b")]);
    const result = store.compare(token, [finding("a", "fp-a")]);

    expect(result.valid).toBe(true);

    if (result.valid) {
      expect(result.delta.resolvedFindingIds).toEqual(["b"]);
    }
  });

  test("invalid token is explicit", () => {
    const store = new FindingDeltaStore();

    expect(store.compare("missing-token", [finding("a", "fp-a")])).toEqual({ valid: false });
  });

  test("repeated error findings are retained in compact delta findings", () => {
    const store = new FindingDeltaStore();
    const token = store.createToken([finding("error-a", "fp-error", "error"), finding("warning-a", "fp-warning")]);
    const result = store.compare(token, [finding("error-a", "fp-error", "error"), finding("warning-a", "fp-warning")]);

    expect(result.valid).toBe(true);

    if (result.valid) {
      expect(result.currentFindings.map((item) => item.id)).toEqual(["error-a"]);
      expect(result.delta.repeatedFindingIds).toEqual(["error-a", "warning-a"]);
    }
  });
});
