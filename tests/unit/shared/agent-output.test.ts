import { describe, expect, test } from "bun:test";
import {
  agentActionSchema,
  agentChangeMetadataSchema,
  agentFindingSchema,
  agentResponseEnvelopeSchema,
  responseModeSchema,
  validateAgentResponseEnvelope
} from "../../../src/shared/agent-output";

const generatedAt = "2026-05-12T10:00:00.000Z";

function validEnvelope() {
  return {
    ok: true as const,
    schemaVersion: "agent-output-v1" as const,
    generatedAt,
    responseMode: "brief" as const,
    summary: "Project is Bun-ready; add explicit Bun types before editing Bun APIs.",
    cacheStatus: "fresh" as const,
    confidence: "high" as const,
    findings: [
      {
        id: "finding-missing-types",
        ruleId: "missing-types-bun-package",
        framework: "bun" as const,
        severity: "warning" as const,
        title: "Add @types/bun for Bun API usage",
        message: "The project uses Bun globals without explicit Bun type declarations.",
        evidence: ["Detected Bun.serve at src/server.ts:1"],
        locations: [{ filePath: "src/server.ts", line: 1, column: 1 }],
        citationIds: ["c1", "local-package-json"],
        fingerprint: "fp-missing-types"
      }
    ],
    actions: [
      {
        id: "action-add-types",
        kind: "command" as const,
        title: "Install Bun type declarations",
        command: "bun add -d @types/bun",
        risk: "low" as const,
        requiresApproval: true,
        reason: "Installing a dependency mutates package.json and the lockfile.",
        citationIds: ["c1"],
        relatedFindingIds: ["finding-missing-types"]
      }
    ],
    examples: [],
    citations: {
      c1: {
        title: "Bun TypeScript",
        url: "https://bun.com/docs/runtime/typescript",
        sourceType: "bun-docs" as const,
        fetchedAt: generatedAt
      },
      "local-package-json": {
        title: "package.json",
        url: "local-project:package.json",
        sourceType: "local-project" as const,
        fetchedAt: generatedAt
      }
    },
    warnings: []
  };
}

describe("agent output contracts", () => {
  test("valid brief envelope passes", () => {
    const envelope = validEnvelope();

    expect(agentResponseEnvelopeSchema.parse(envelope)).toEqual(envelope);
    expect(validateAgentResponseEnvelope(envelope)).toEqual(envelope);
  });

  test("invalid response mode fails", () => {
    expect(responseModeSchema.parse("brief")).toBe("brief");
    expect(() => responseModeSchema.parse("compact")).toThrow();
  });

  test("finding without evidence fails", () => {
    const finding = validEnvelope().findings[0]!;

    expect(agentFindingSchema.parse(finding)).toEqual(finding);
    expect(() => agentFindingSchema.parse({ ...finding, evidence: [] })).toThrow();
  });

  test("action without approval flag fails", () => {
    const action = validEnvelope().actions[0]!;
    const { requiresApproval: _requiresApproval, ...actionWithoutApproval } = action;

    expect(agentActionSchema.parse(action)).toEqual(action);
    expect(() => agentActionSchema.parse(actionWithoutApproval)).toThrow();
  });

  test("referenced missing citation ID fails helper validation", () => {
    const envelope = validEnvelope();
    envelope.findings[0]!.citationIds.push("missing-citation");

    expect(agentResponseEnvelopeSchema.parse(envelope)).toEqual(envelope);
    expect(() => validateAgentResponseEnvelope(envelope)).toThrow(/missing-citation/);
  });

  test("change metadata without evidence fails", () => {
    expect(
      agentChangeMetadataSchema.parse({
        sinceVersion: "1.3.13",
        sinceDate: "2026-04-20",
        evidence: "official-source",
        citationIds: ["c1"]
      })
    ).toEqual({
      sinceVersion: "1.3.13",
      sinceDate: "2026-04-20",
      evidence: "official-source",
      citationIds: ["c1"]
    });

    expect(() =>
      agentChangeMetadataSchema.parse({
        sinceVersion: "1.3.13",
        citationIds: ["c1"]
      })
    ).toThrow();
  });
});
