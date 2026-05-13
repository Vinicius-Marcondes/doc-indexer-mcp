import type { AgentAction, AgentFinding } from "../shared/agent-output";
import type { Recommendation } from "../shared/contracts";

interface VerifyActionInput {
  readonly id: string;
  readonly title: string;
  readonly command: string;
  readonly reason: string;
  readonly citationIds: string[];
  readonly relatedFindingIds: string[];
}

const commandStopWords = [" before ", " when ", " if ", " after "];

function extractBunCommand(actionText: string): string | undefined {
  const match = actionText.match(/\bbun\s+(?:add|install|remove|update|test|run|x|pm|audit|outdated|why)\b[^\n.]*/u);
  if (match === null) {
    return undefined;
  }

  let command = match[0].trim();
  const lowerCommand = command.toLowerCase();
  const stopIndex = commandStopWords
    .map((stopWord) => lowerCommand.indexOf(stopWord))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];

  if (stopIndex !== undefined) {
    command = command.slice(0, stopIndex).trim();
  }

  return command.replace(/[,:;]$/u, "");
}

function commandKind(command: string): AgentAction["kind"] {
  if (/^bun\s+(?:test|run\s+(?:test|typecheck|check|lint))\b/u.test(command)) {
    return "verify";
  }

  return "command";
}

function riskForCommand(command: string): AgentAction["risk"] {
  if (/^bun\s+(?:remove|update)\b/u.test(command)) {
    return "high";
  }

  if (/^bun\s+(?:add|install)\b/u.test(command)) {
    return "medium";
  }

  return "low";
}

function localFileSource(recommendation: Recommendation): string | undefined {
  const source = recommendation.sources.find((item) => item.startsWith("local-project:"));
  return source?.slice("local-project:".length);
}

function shouldBeEditAction(recommendation: Recommendation): boolean {
  return /^(add|align|update|set)\b/iu.test(recommendation.recommendedAction ?? "") && localFileSource(recommendation) !== undefined;
}

function shouldBeHigherRiskManualAction(recommendation: Recommendation): boolean {
  return /lockfile|dependency|package manager|package-manager|install|remove|delete|regenerate/iu.test(
    `${recommendation.title} ${recommendation.detail} ${recommendation.recommendedAction ?? ""}`
  );
}

export function createVerifyAction(input: VerifyActionInput): AgentAction {
  return {
    id: input.id,
    kind: "verify",
    title: input.title,
    command: input.command,
    risk: "low",
    requiresApproval: true,
    reason: input.reason,
    citationIds: input.citationIds,
    relatedFindingIds: input.relatedFindingIds
  };
}

export function createActionFromRecommendation(
  recommendation: Recommendation,
  finding: AgentFinding
): AgentAction | null {
  const recommendedAction = recommendation.recommendedAction?.trim();
  if (recommendedAction === undefined || recommendedAction.length === 0) {
    return null;
  }

  const command = extractBunCommand(recommendedAction);
  if (command !== undefined) {
    const kind = commandKind(command);
    return {
      id: `action-${recommendation.id}`,
      kind,
      title: recommendation.title,
      command,
      risk: riskForCommand(command),
      requiresApproval: true,
      reason: recommendedAction,
      citationIds: finding.citationIds,
      relatedFindingIds: [finding.id]
    };
  }

  if (shouldBeEditAction(recommendation)) {
    return {
      id: `action-${recommendation.id}`,
      kind: "edit",
      title: recommendation.title,
      filePath: localFileSource(recommendation),
      risk: "medium",
      requiresApproval: true,
      reason: recommendedAction,
      citationIds: finding.citationIds,
      relatedFindingIds: [finding.id]
    };
  }

  return {
    id: `action-${recommendation.id}`,
    kind: "manual",
    title: recommendation.title,
    risk: shouldBeHigherRiskManualAction(recommendation) ? "medium" : "low",
    requiresApproval: true,
    reason: recommendedAction,
    citationIds: finding.citationIds,
    relatedFindingIds: [finding.id]
  };
}

export function createActionsFromRecommendations(
  recommendations: readonly Recommendation[],
  findings: readonly AgentFinding[]
): AgentAction[] {
  const findingsById = new Map(findings.map((finding) => [finding.id, finding]));
  return recommendations
    .map((recommendation) => {
      const finding = findingsById.get(recommendation.id);
      return finding === undefined ? null : createActionFromRecommendation(recommendation, finding);
    })
    .filter((action): action is AgentAction => action !== null);
}
