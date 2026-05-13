import type { AgentAction, AgentFinding, AgentResponseEnvelope, ResponseMode } from "./agent-output";

export interface ResponseBudget {
  readonly summaryMaxChars: number;
  readonly maxFindings: number;
  readonly maxActions: number;
  readonly maxExamples: number;
}

const budgets: Record<ResponseMode, ResponseBudget> = {
  brief: {
    summaryMaxChars: 500,
    maxFindings: 3,
    maxActions: 3,
    maxExamples: 0
  },
  standard: {
    summaryMaxChars: 1200,
    maxFindings: 8,
    maxActions: 5,
    maxExamples: 1
  },
  full: {
    summaryMaxChars: Number.POSITIVE_INFINITY,
    maxFindings: Number.POSITIVE_INFINITY,
    maxActions: Number.POSITIVE_INFINITY,
    maxExamples: Number.POSITIVE_INFINITY
  }
};

const severityRank: Record<AgentFinding["severity"], number> = {
  error: 0,
  warning: 1,
  info: 2
};

const actionKindRank: Record<AgentAction["kind"], number> = {
  edit: 0,
  command: 1,
  verify: 2,
  manual: 3
};

export function responseBudgetForMode(mode: ResponseMode): ResponseBudget {
  return budgets[mode];
}

export function truncateSummary(summary: string, maxChars: number): string {
  if (summary.length <= maxChars) {
    return summary;
  }

  if (maxChars <= 3) {
    return ".".repeat(maxChars);
  }

  return `${summary.slice(0, maxChars - 3).trimEnd()}...`;
}

function findingHasRelatedAction(finding: AgentFinding, actions: readonly AgentAction[]): boolean {
  return actions.some((action) => action.relatedFindingIds.includes(finding.id));
}

function rankFindings(findings: readonly AgentFinding[], actions: readonly AgentAction[]): AgentFinding[] {
  return [...findings].sort((left, right) => {
    const severityDelta = severityRank[left.severity] - severityRank[right.severity];
    if (severityDelta !== 0) {
      return severityDelta;
    }

    const leftActionable = left.fix !== undefined || findingHasRelatedAction(left, actions);
    const rightActionable = right.fix !== undefined || findingHasRelatedAction(right, actions);
    if (leftActionable !== rightActionable) {
      return leftActionable ? -1 : 1;
    }

    const ruleDelta = left.ruleId.localeCompare(right.ruleId);
    if (ruleDelta !== 0) {
      return ruleDelta;
    }

    return left.id.localeCompare(right.id);
  });
}

function rankActions(actions: readonly AgentAction[], findingOrder: ReadonlyMap<string, number>): AgentAction[] {
  return [...actions].sort((left, right) => {
    const leftRank = Math.min(...left.relatedFindingIds.map((id) => findingOrder.get(id) ?? Number.POSITIVE_INFINITY));
    const rightRank = Math.min(...right.relatedFindingIds.map((id) => findingOrder.get(id) ?? Number.POSITIVE_INFINITY));

    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }

    const kindDelta = actionKindRank[left.kind] - actionKindRank[right.kind];
    if (kindDelta !== 0) {
      return kindDelta;
    }

    return left.id.localeCompare(right.id);
  });
}

export function applyResponseBudget(response: AgentResponseEnvelope): AgentResponseEnvelope {
  const budget = responseBudgetForMode(response.responseMode);

  if (response.responseMode === "full") {
    return response;
  }

  const rankedFindings = rankFindings(response.findings, response.actions);
  const findings = rankedFindings.slice(0, budget.maxFindings);
  const selectedFindingIds = new Set(findings.map((finding) => finding.id));
  const findingOrder = new Map(rankedFindings.map((finding, index) => [finding.id, index]));
  const relatedActions = response.actions.filter(
    (action) =>
      action.relatedFindingIds.length === 0 ||
      action.relatedFindingIds.some((findingId) => selectedFindingIds.has(findingId))
  );
  const actions = rankActions(relatedActions, findingOrder).slice(0, budget.maxActions);

  return {
    ...response,
    summary: truncateSummary(response.summary, budget.summaryMaxChars),
    findings,
    actions,
    examples: response.examples.slice(0, budget.maxExamples)
  };
}
