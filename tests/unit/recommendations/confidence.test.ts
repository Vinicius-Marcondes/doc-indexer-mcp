import { describe, expect, test } from "bun:test";
import { calculateConfidence } from "../../../src/recommendations/confidence";

describe("confidence calculation", () => {
  test("high confidence with fresh official docs and local evidence", () => {
    const result = calculateConfidence({
      cacheStatus: "fresh",
      officialSourceCount: 1,
      localEvidenceCount: 2
    });

    expect(result.confidence).toBe("high");
    expect(result.warnings).toEqual([]);
  });

  test("medium confidence with fresh docs and partial project data", () => {
    const result = calculateConfidence({
      cacheStatus: "fresh",
      officialSourceCount: 1,
      localEvidenceCount: 0,
      partialProjectData: true
    });

    expect(result.confidence).toBe("medium");
    expect(result.warnings[0]?.id).toBe("confidence-partial-project-data");
  });

  test("low confidence with stale cache", () => {
    const result = calculateConfidence({
      cacheStatus: "stale",
      officialSourceCount: 1,
      localEvidenceCount: 2
    });

    expect(result.confidence).toBe("low");
    expect(result.warnings[0]?.id).toBe("confidence-stale-cache");
  });

  test("low confidence with parse failures", () => {
    const result = calculateConfidence({
      cacheStatus: "fresh",
      officialSourceCount: 1,
      localEvidenceCount: 2,
      parseFailureCount: 1
    });

    expect(result.confidence).toBe("low");
    expect(result.warnings[0]?.id).toBe("confidence-parse-failures");
  });

  test("confidence warnings are included", () => {
    const result = calculateConfidence({
      cacheStatus: "stale",
      officialSourceCount: 0,
      localEvidenceCount: 0,
      partialProjectData: true,
      parseFailureCount: 1
    });

    expect(result.confidence).toBe("low");
    expect(result.warnings.map((warning) => warning.id)).toEqual([
      "confidence-parse-failures",
      "confidence-stale-cache",
      "confidence-partial-project-data",
      "confidence-missing-official-sources"
    ]);
  });
});
