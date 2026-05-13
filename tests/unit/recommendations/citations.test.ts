import { describe, expect, test } from "bun:test";
import { validateAgentResponseEnvelope } from "../../../src/shared/agent-output";
import { buildCitationMap, citationIdForSource } from "../../../src/recommendations/citations";

const fetchedAt = "2026-05-12T10:00:00.000Z";

describe("citation map builder", () => {
  test("duplicate Bun docs URLs produce one citation ID", () => {
    const result = buildCitationMap([
      {
        title: "Bun TypeScript docs",
        url: "https://bun.com/docs/runtime/typescript",
        sourceType: "bun-docs",
        fetchedAt
      },
      {
        title: "Bun TypeScript docs",
        url: "https://bun.com/docs/runtime/typescript",
        sourceType: "bun-docs",
        fetchedAt
      }
    ]);

    expect(Object.keys(result.citations)).toHaveLength(1);
    expect(result.citationIdsBySource["https://bun.com/docs/runtime/typescript"]).toBe("c1");
  });

  test("npm source and Bun docs source with different URLs produce different IDs", () => {
    const result = buildCitationMap([
      {
        title: "Bun TypeScript docs",
        url: "https://bun.com/docs/runtime/typescript",
        sourceType: "bun-docs",
        fetchedAt
      },
      {
        title: "npm: zod",
        url: "https://registry.npmjs.org/zod",
        sourceType: "npm-registry",
        fetchedAt
      }
    ]);

    expect(Object.keys(result.citations).sort()).toEqual(["c1", "c2"]);
    expect(result.citationIdsBySource["https://bun.com/docs/runtime/typescript"]).not.toBe(
      result.citationIdsBySource["https://registry.npmjs.org/zod"]
    );
  });

  test("local project evidence maps to safe local citation entries", () => {
    const result = buildCitationMap([{ kind: "local", label: "package.json", fetchedAt }]);
    const citationId = citationIdForSource("local-project:package.json");

    expect(result.citations[citationId]).toEqual({
      title: "package.json",
      url: "local-project:package.json",
      sourceType: "local-project",
      fetchedAt
    });
    expect(result.citationIdsBySource["local-project:package.json"]).toBe(citationId);
  });

  test("missing citation references are detected by envelope validation", () => {
    const result = buildCitationMap([{ kind: "local", label: "package.json", fetchedAt }]);

    expect(() =>
      validateAgentResponseEnvelope({
        ok: true,
        schemaVersion: "agent-output-v1",
        generatedAt: fetchedAt,
        responseMode: "brief",
        summary: "Invalid citation reference fixture.",
        cacheStatus: "fresh",
        confidence: "high",
        findings: [
          {
            id: "finding",
            ruleId: "rule",
            framework: "bun",
            severity: "warning",
            title: "Finding",
            message: "Finding message.",
            evidence: ["evidence"],
            locations: [],
            citationIds: ["missing-citation"],
            fingerprint: "fp"
          }
        ],
        actions: [],
        examples: [],
        citations: result.citations,
        warnings: []
      })
    ).toThrow(/missing-citation/);
  });
});
