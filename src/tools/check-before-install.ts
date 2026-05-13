import * as z from "zod/v4";
import { analyzeLockfiles } from "../analyzers/lockfiles";
import { createActionFromRecommendation } from "../recommendations/actions";
import { changeMetadataFromNpmVersion } from "../recommendations/change-metadata";
import { createDependencyPlan, type DependencyType } from "../recommendations/dependency-plan";
import { citationIdForSource, normalizeRecommendationsToFindings } from "../recommendations/finding-normalizer";
import {
  type AgentAction,
  type AgentCitation,
  type AgentCitationMap,
  type AgentFinding,
  type AgentResponseEnvelope,
  type AgentWarning,
  responseModeSchema
} from "../shared/agent-output";
import type { CacheStatus, Confidence, Recommendation, ResponseWarning } from "../shared/contracts";
import { createInvalidInputError, type StructuredError } from "../shared/errors";
import { hashProjectPath } from "../shared/project-hash";
import { applyResponseBudget } from "../shared/response-budget";
import { resolveProjectRoot } from "../security/project-paths";
import type { NpmPackageMetadata, NpmRegistryAdapter, NpmRegistryResult } from "../sources/npm-registry";

const packageRequestSchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(/^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/iu),
  requestedRange: z.string().min(1).optional()
});

const checkBeforeInstallInputSchema = z
  .object({
    projectPath: z.string().min(1),
    packages: z.array(packageRequestSchema).min(1),
    dependencyType: z.enum(["dependencies", "devDependencies", "optionalDependencies"]).optional(),
    responseMode: responseModeSchema.optional(),
    forceRefresh: z.boolean().optional()
  })
  .strict();

export interface CheckBeforeInstallDependencies {
  readonly registryAdapter: NpmRegistryAdapter;
  readonly now?: () => string;
}

export interface CheckBeforeInstallFailure {
  readonly ok: false;
  readonly error: StructuredError;
}

export type CheckBeforeInstallSuccess = AgentResponseEnvelope & {
  readonly packageManager: string;
  readonly packages: Array<{
    readonly name: string;
    readonly requestedRange?: string;
    readonly selectedVersion?: string;
  }>;
};

export type CheckBeforeInstallResult = CheckBeforeInstallSuccess | CheckBeforeInstallFailure;

function nonBunWarning(packageManager: string): ResponseWarning {
  return {
    id: "dependency-plan-non-bun-project",
    title: "Project is not clearly Bun-first",
    detail: `Dependency command guidance is lower-confidence because lockfile evidence indicates packageManager=${packageManager}.`,
    evidence: [`packageManager=${packageManager}`],
    sources: ["local-project:lockfiles"]
  };
}

function sourceTypeFor(source: string): AgentCitation["sourceType"] {
  if (source.startsWith("local-project:")) {
    return "local-project";
  }

  if (source.startsWith("https://registry.npmjs.org/")) {
    return "npm-registry";
  }

  return "bun-docs";
}

function titleForSource(source: string): string {
  if (source.startsWith("local-project:")) {
    return source.slice("local-project:".length);
  }

  if (source.startsWith("https://registry.npmjs.org/")) {
    return `npm registry: ${decodeURIComponent(source.slice("https://registry.npmjs.org/".length))}`;
  }

  return source;
}

function citationMapFor(sources: readonly string[], generatedAt: string): AgentCitationMap {
  const citations: AgentCitationMap = {};

  for (const source of sources) {
    citations[citationIdForSource(source)] = {
      title: titleForSource(source),
      url: source,
      sourceType: sourceTypeFor(source),
      fetchedAt: generatedAt
    };
  }

  return citations;
}

function warningsToAgentWarnings(warnings: readonly ResponseWarning[]): AgentWarning[] {
  return warnings.map((warning) => ({
    id: warning.id,
    title: warning.title,
    message: warning.detail,
    evidence: warning.evidence,
    citationIds: warning.sources.map(citationIdForSource)
  }));
}

function aggregateCacheStatus(results: readonly Extract<NpmRegistryResult, { ok: true }>[]): CacheStatus {
  return results.some((result) => result.cacheStatus === "stale") ? "stale" : "fresh";
}

function aggregateConfidence(packageManager: string, results: readonly Extract<NpmRegistryResult, { ok: true }>[]): Confidence {
  if (results.some((result) => result.confidence === "low")) {
    return "low";
  }

  if (packageManager !== "bun" || results.some((result) => result.confidence === "medium")) {
    return "medium";
  }

  return "high";
}

function installAction(command: string, citationIds: string[]): AgentAction {
  return {
    id: "action-check-before-install-command",
    kind: "command",
    title: "Install with Bun",
    command,
    risk: "medium",
    requiresApproval: true,
    reason: "Installing packages mutates package.json and the lockfile; the MCP server only recommends this command.",
    citationIds,
    relatedFindingIds: []
  };
}

function summaryFor(packageNames: readonly string[], packageManager: string, warningCount: number): string {
  const packageText = packageNames.join(", ");
  const warningText = warningCount === 0 ? "no npm metadata warnings" : `${warningCount} npm metadata warning(s)`;
  return `Pre-install check for ${packageText}: project package manager is ${packageManager}; ${warningText}. Suggested commands are recommendations only.`;
}

function attachNpmChangeMetadata(
  findings: readonly AgentFinding[],
  packages: ReadonlyArray<{ readonly name: string; readonly selectedVersion?: string }>,
  metadata: readonly NpmPackageMetadata[]
): AgentFinding[] {
  return findings.map((finding) => {
    for (const plannedPackage of packages) {
      if (plannedPackage.selectedVersion === undefined) {
        continue;
      }

      const packageMetadata = metadata.find((item) => item.name === plannedPackage.name);
      const versionMetadata = packageMetadata?.versions[plannedPackage.selectedVersion];

      if (
        packageMetadata === undefined ||
        versionMetadata === undefined ||
        !finding.id.includes(`${plannedPackage.name}-${plannedPackage.selectedVersion}`)
      ) {
        continue;
      }

      const change = changeMetadataFromNpmVersion({
        version: versionMetadata,
        citationIds: [citationIdForSource(packageMetadata.sourceUrl)]
      });

      return change === undefined ? finding : { ...finding, change };
    }

    return finding;
  });
}

function applyInstallBudget(response: AgentResponseEnvelope, commandAction: AgentAction): AgentResponseEnvelope {
  const budgeted = applyResponseBudget(response);

  if (response.responseMode === "full") {
    return budgeted;
  }

  const maxFindings = response.responseMode === "brief" ? 2 : 8;
  const maxActions = response.responseMode === "brief" ? 2 : 5;

  return {
    ...budgeted,
    findings: budgeted.findings.slice(0, maxFindings),
    actions: [commandAction, ...budgeted.actions.filter((action) => action.id !== commandAction.id)].slice(0, maxActions)
  };
}

export async function checkBeforeInstall(
  input: unknown,
  dependencies: CheckBeforeInstallDependencies
): Promise<CheckBeforeInstallResult> {
  const parsed = checkBeforeInstallInputSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      error: createInvalidInputError(parsed.error)
    };
  }

  const root = resolveProjectRoot(parsed.data.projectPath);

  if (!root.ok) {
    return {
      ok: false,
      error: root.error
    };
  }

  const registryResults: Array<Extract<NpmRegistryResult, { ok: true }>> = [];
  const metadata: NpmPackageMetadata[] = [];

  for (const packageRequest of parsed.data.packages) {
    const result = await dependencies.registryAdapter.fetchPackageMetadata(packageRequest.name);

    if (!result.ok) {
      return result;
    }

    registryResults.push(result);
    metadata.push(result.metadata);
  }

  const packageManager = analyzeLockfiles(root.projectRoot).packageManager.name;
  const dependencyType = (parsed.data.dependencyType ?? "dependencies") as DependencyType;
  const plan = createDependencyPlan({
    dependencyType,
    packages: parsed.data.packages.map((packageRequest, index) => ({
      name: packageRequest.name,
      ...(packageRequest.requestedRange === undefined ? {} : { requestedRange: packageRequest.requestedRange }),
      metadata: metadata[index]!
    }))
  });
  const recommendationWarnings = [
    ...plan.deprecationWarnings,
    ...plan.peerDependencyWarnings,
    ...plan.engineWarnings
  ];
  const recommendations: Recommendation[] = [...plan.recommendations, ...recommendationWarnings];
  const localWarnings = packageManager === "bun" ? [] : [nonBunWarning(packageManager)];
  const registryWarnings = registryResults.flatMap((result) => result.warnings);
  const allWarningSources = [...localWarnings, ...registryWarnings].flatMap((warning) => warning.sources);
  const generatedAt = dependencies.now?.() ?? new Date().toISOString();
  const allSources = [
    ...recommendations.flatMap((recommendation) => recommendation.sources),
    ...allWarningSources
  ];
  const citations = citationMapFor(allSources, generatedAt);
  const citationIdsBySource = Object.fromEntries(allSources.map((source) => [source, citationIdForSource(source)] as const));
  const normalizedFindings = normalizeRecommendationsToFindings(recommendations, {
    projectHash: hashProjectPath(root.projectRoot),
    citationIdsBySource
  });
  const findings = attachNpmChangeMetadata(normalizedFindings, plan.packages, metadata);
  const metadataActions = recommendationWarnings
    .map((recommendation) => {
      const finding = findings.find((item) => item.id === recommendation.id);
      return finding === undefined ? null : createActionFromRecommendation(recommendation, finding);
    })
    .filter((action): action is AgentAction => action !== null);
  const commandAction = installAction(plan.installCommand, metadata.map((item) => citationIdForSource(item.sourceUrl)));
  const envelope: AgentResponseEnvelope = {
    ok: true,
    schemaVersion: "agent-output-v1",
    generatedAt,
    responseMode: parsed.data.responseMode ?? "brief",
    summary: summaryFor(
      parsed.data.packages.map((item) => item.name),
      packageManager,
      recommendationWarnings.length
    ),
    cacheStatus: aggregateCacheStatus(registryResults),
    confidence: aggregateConfidence(packageManager, registryResults),
    findings,
    actions: [commandAction, ...metadataActions],
    examples: [],
    citations,
    warnings: warningsToAgentWarnings([...localWarnings, ...registryWarnings])
  };

  return {
    ...applyInstallBudget(envelope, commandAction),
    packageManager,
    packages: plan.packages
  };
}
