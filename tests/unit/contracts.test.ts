import { describe, expect, test } from "bun:test";
import {
  baseToolResponseSchema,
  cacheStatusSchema,
  confidenceSchema,
  recommendationSchema,
  sourceCitationSchema
} from "../../packages/contracts/src/contracts";

describe("core result contracts", () => {
  test("validates allowed cache status values", () => {
    for (const status of ["fresh", "stale", "miss", "disabled"] as const) {
      expect(cacheStatusSchema.parse(status)).toBe(status);
    }

    expect(() => cacheStatusSchema.parse("expired")).toThrow();
  });

  test("validates allowed confidence values", () => {
    for (const confidence of ["high", "medium", "low"] as const) {
      expect(confidenceSchema.parse(confidence)).toBe(confidence);
    }

    expect(() => confidenceSchema.parse("certain")).toThrow();
  });

  test("validates required source citation fields", () => {
    const citation = {
      title: "Bun TypeScript",
      url: "https://bun.com/docs/runtime/typescript",
      sourceType: "bun-docs" as const,
      fetchedAt: "2026-05-12T00:00:00.000Z"
    };

    expect(sourceCitationSchema.parse(citation)).toEqual(citation);
    expect(() => sourceCitationSchema.parse({ ...citation, title: undefined })).toThrow();
    expect(() => sourceCitationSchema.parse({ ...citation, sourceType: "blog" })).toThrow();
  });

  test("validates required recommendation fields", () => {
    const recommendation = {
      id: "bun-types",
      severity: "warning" as const,
      title: "Add Bun types",
      detail: "The project uses Bun globals without explicit Bun types.",
      evidence: ["Bun.version found in src/index.ts"],
      sources: ["https://bun.com/docs/runtime/typescript"],
      recommendedAction: "Run bun add -d @types/bun"
    };

    expect(recommendationSchema.parse(recommendation)).toEqual(recommendation);
    expect(() => recommendationSchema.parse({ ...recommendation, evidence: [] })).toThrow();
    expect(() => recommendationSchema.parse({ ...recommendation, severity: "critical" })).toThrow();
  });

  test("validates required base response fields", () => {
    const response = {
      generatedAt: "2026-05-12T00:00:00.000Z",
      cacheStatus: "fresh" as const,
      sources: [
        {
          title: "Bun TypeScript",
          url: "https://bun.com/docs/runtime/typescript",
          sourceType: "bun-docs" as const,
          fetchedAt: "2026-05-12T00:00:00.000Z"
        }
      ],
      confidence: "high" as const,
      recommendations: [
        {
          id: "bun-types",
          severity: "info" as const,
          title: "Bun types present",
          detail: "The project declares Bun types.",
          evidence: ["types includes bun"],
          sources: ["https://bun.com/docs/runtime/typescript"]
        }
      ],
      warnings: []
    };

    expect(baseToolResponseSchema.parse(response)).toEqual(response);
    expect(() => baseToolResponseSchema.parse({ ...response, generatedAt: undefined })).toThrow();
    expect(() => baseToolResponseSchema.parse({ ...response, recommendations: undefined })).toThrow();
  });
});
