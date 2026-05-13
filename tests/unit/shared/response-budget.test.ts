import { describe, expect, test } from "bun:test";
import type { AgentAction, AgentFinding, AgentResponseEnvelope } from "../../../src/shared/agent-output";
import { applyResponseBudget, responseBudgetForMode } from "../../../src/shared/response-budget";

const generatedAt = "2026-05-12T10:00:00.000Z";

function finding(id: string, severity: AgentFinding["severity"], hasFix = false): AgentFinding {
  return {
    id,
    ruleId: id,
    framework: "bun",
    severity,
    title: `Finding ${id}`,
    message: `Message for ${id}`,
    evidence: [`Evidence for ${id}`],
    locations: [],
    citationIds: ["c1"],
    ...(hasFix ? { fix: { intent: "Apply the obvious safe edit" } } : {}),
    fingerprint: `fp-${id}`
  };
}

function action(id: string, relatedFindingId: string): AgentAction {
  return {
    id,
    kind: "command",
    title: `Action ${id}`,
    command: `bun run ${id}`,
    risk: "low",
    requiresApproval: true,
    reason: `Action for ${relatedFindingId}`,
    citationIds: ["c1"],
    relatedFindingIds: [relatedFindingId]
  };
}

function envelope(
  responseMode: AgentResponseEnvelope["responseMode"],
  findings: AgentFinding[],
  actions: AgentAction[],
  summary = "Project summary"
): AgentResponseEnvelope {
  return {
    ok: true,
    schemaVersion: "agent-output-v1",
    generatedAt,
    responseMode,
    summary,
    cacheStatus: "fresh",
    confidence: "high",
    findings,
    actions,
    examples: [],
    citations: {
      c1: {
        title: "Bun docs",
        url: "https://bun.com/docs/runtime/typescript",
        sourceType: "bun-docs",
        fetchedAt: generatedAt
      }
    },
    warnings: []
  };
}

describe("response budgets", () => {
  test("brief summary is truncated within budget", () => {
    const summary = "x".repeat(700);
    const budgeted = applyResponseBudget(envelope("brief", [], [], summary));

    expect(budgeted.summary.length).toBeLessThanOrEqual(responseBudgetForMode("brief").summaryMaxChars);
    expect(budgeted.summary.endsWith("...")).toBe(true);
  });

  test("brief limits findings and actions", () => {
    const findings = Array.from({ length: 5 }, (_, index) => finding(`warning-${index}`, "warning"));
    const actions = findings.map((item) => action(`action-${item.id}`, item.id));
    const budgeted = applyResponseBudget(envelope("brief", findings, actions));

    expect(budgeted.findings).toHaveLength(3);
    expect(budgeted.actions).toHaveLength(3);
  });

  test("standard limits findings and actions", () => {
    const findings = Array.from({ length: 10 }, (_, index) => finding(`warning-${index}`, "warning"));
    const actions = findings.map((item) => action(`action-${item.id}`, item.id));
    const budgeted = applyResponseBudget(envelope("standard", findings, actions));

    expect(budgeted.findings).toHaveLength(8);
    expect(budgeted.actions).toHaveLength(5);
    expect(budgeted.summary.length).toBeLessThanOrEqual(responseBudgetForMode("standard").summaryMaxChars);
  });

  test("error severity findings outrank warnings and info", () => {
    const budgeted = applyResponseBudget(
      envelope("brief", [
        finding("info-a", "info", true),
        finding("warning-a", "warning"),
        finding("error-b", "error"),
        finding("error-a", "error", true),
        finding("warning-b", "warning", true)
      ], [])
    );

    expect(budgeted.findings.map((item) => item.id)).toEqual(["error-a", "error-b", "warning-b"]);
  });

  test("full mode preserves all findings", () => {
    const findings = Array.from({ length: 12 }, (_, index) => finding(`finding-${index}`, "info"));
    const actions = findings.map((item) => action(`action-${item.id}`, item.id));
    const summary = "x".repeat(1500);
    const budgeted = applyResponseBudget(envelope("full", findings, actions, summary));

    expect(budgeted.findings).toHaveLength(12);
    expect(budgeted.actions).toHaveLength(12);
    expect(budgeted.summary).toBe(summary);
  });
});
