import { createHash } from "node:crypto";
export { citationIdForSource } from "./citations";
import { citationIdForSource } from "./citations";
import type { AgentFinding } from "../shared/agent-output";
import type { Recommendation } from "../shared/contracts";

export interface NormalizeRecommendationOptions {
  readonly projectHash: string;
  readonly scope?: string;
  readonly citationIdsBySource?: Readonly<Record<string, string>>;
  readonly sourceHashes?: Readonly<Record<string, string>>;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }

  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nestedValue]) => `${JSON.stringify(key)}:${stableJson(nestedValue)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function citationIdsFor(recommendation: Recommendation, options: NormalizeRecommendationOptions): string[] {
  return recommendation.sources.map((source) => options.citationIdsBySource?.[source] ?? citationIdForSource(source));
}

function sourceFingerprintParts(recommendation: Recommendation, options: NormalizeRecommendationOptions): string[] {
  return recommendation.sources.map((source) => `${source}:${options.sourceHashes?.[source] ?? "unhashed"}`);
}

export function findingFingerprint(recommendation: Recommendation, options: NormalizeRecommendationOptions): string {
  return sha256(
    stableJson({
      schemaVersion: "agent-output-v1",
      projectHash: options.projectHash,
      scope: options.scope ?? "project",
      ruleId: recommendation.id,
      severity: recommendation.severity,
      evidence: recommendation.evidence,
      sources: sourceFingerprintParts(recommendation, options)
    })
  );
}

export function normalizeRecommendationToFinding(
  recommendation: Recommendation,
  options: NormalizeRecommendationOptions
): AgentFinding {
  return {
    id: recommendation.id,
    ruleId: recommendation.id,
    framework: "bun",
    severity: recommendation.severity,
    title: recommendation.title,
    message: recommendation.detail,
    evidence: recommendation.evidence,
    locations: [],
    citationIds: citationIdsFor(recommendation, options),
    fingerprint: findingFingerprint(recommendation, options)
  };
}

export function normalizeRecommendationsToFindings(
  recommendations: readonly Recommendation[],
  options: NormalizeRecommendationOptions
): AgentFinding[] {
  return recommendations.map((recommendation) => normalizeRecommendationToFinding(recommendation, options));
}
