import { basename } from "node:path";
import { readFileSync } from "node:fs";
import * as z from "zod/v4";
import { defaultFindingDeltaStore, type FindingDeltaStore } from "../cache/finding-delta";
import { computeContentHash } from "../cache/sqlite-cache";
import type { FindingCacheStore, FindingProjectFileHash } from "../cache/finding-cache";
import { createActionsFromRecommendations, createVerifyAction } from "../recommendations/actions";
import { citationIdForSource, normalizeRecommendationsToFindings } from "../recommendations/finding-normalizer";
import {
  type AgentCitation,
  type AgentCitationMap,
  type AgentResponseEnvelope,
  type AgentWarning,
  responseModeSchema
} from "../shared/agent-output";
import type { Recommendation } from "../shared/contracts";
import { createInvalidInputError, type StructuredError } from "../shared/errors";
import { applyResponseBudget } from "../shared/response-budget";
import { analyzeBunProject, type AnalyzeBunProjectDependencies, type AnalyzeBunProjectSuccess } from "./analyze-bun-project";
import type { ProjectProfile } from "./review-bun-project";

const focusSchema = z.enum(["typescript", "dependencies", "tests", "lockfile", "runtime", "all"]);

const projectHealthInputSchema = z
  .object({
    projectPath: z.string().min(1),
    focus: focusSchema.optional(),
    responseMode: responseModeSchema.optional(),
    sinceToken: z.string().min(1).optional(),
    forceRefresh: z.boolean().optional()
  })
  .strict();

type Focus = z.infer<typeof focusSchema>;

export interface ProjectHealthFailure {
  readonly ok: false;
  readonly error: StructuredError;
}

export type ProjectHealthSuccess = AgentResponseEnvelope & {
  readonly projectProfile: ProjectProfile;
};

export type ProjectHealthResult = ProjectHealthSuccess | ProjectHealthFailure;

export type ProjectHealthDependencies = AnalyzeBunProjectDependencies & {
  readonly deltaStore?: FindingDeltaStore;
  readonly findingCache?: FindingCacheStore;
};

function matchesFocus(recommendation: Recommendation, focus: Focus): boolean {
  if (focus === "all") {
    return true;
  }

  if (focus === "typescript") {
    return /typescript|tsconfig|types-bun|bun-types/u.test(recommendation.id);
  }

  if (focus === "dependencies") {
    return /lockfile|dependency|package/u.test(recommendation.id);
  }

  if (focus === "lockfile") {
    return /lockfile|lockb/u.test(recommendation.id);
  }

  if (focus === "tests") {
    return /test/u.test(recommendation.id);
  }

  if (focus === "runtime") {
    return /runtime|bun-api|types-bun|serve|sqlite|password/u.test(recommendation.id);
  }

  return false;
}

function projectProfile(analysis: AnalyzeBunProjectSuccess): ProjectProfile {
  return {
    name: analysis.packageJson.name ?? basename(analysis.projectPath),
    packageManager: analysis.packageManager.name,
    lockfiles: analysis.lockfiles.present,
    scripts: analysis.scripts,
    dependencyCount: Object.keys(analysis.dependencies).length,
    devDependencyCount: Object.keys(analysis.devDependencies).length,
    sourceFileCount: analysis.sourceAnalysis.discovery.files.length,
    testFileCount: analysis.testAnalysis.testFiles.length
  };
}

function titleForSource(source: string): string {
  if (source.startsWith("local-project:")) {
    return source.slice("local-project:".length);
  }

  if (source === "https://bun.com/docs/runtime/typescript") {
    return "Bun TypeScript docs";
  }

  if (source === "https://bun.com/docs/pm/lockfile") {
    return "Bun lockfile docs";
  }

  if (source === "https://bun.com/docs/test") {
    return "Bun test docs";
  }

  if (source.startsWith("https://registry.npmjs.org/")) {
    return `npm registry: ${source.slice("https://registry.npmjs.org/".length)}`;
  }

  if (source.startsWith("https://bun.com/blog/") || source.startsWith("https://github.com/oven-sh/bun/releases")) {
    return "Bun release notes";
  }

  return source;
}

function sourceTypeFor(source: string): AgentCitation["sourceType"] {
  if (source.startsWith("local-project:")) {
    return "local-project";
  }

  if (source.startsWith("https://registry.npmjs.org/")) {
    return "npm-registry";
  }

  if (source.startsWith("https://bun.com/blog/") || source.startsWith("https://github.com/oven-sh/bun/releases")) {
    return "bun-release";
  }

  if (source.startsWith("https://modelcontextprotocol.io/") || source.startsWith("https://github.com/modelcontextprotocol/")) {
    return "mcp-docs";
  }

  if (source.startsWith("https://www.typescriptlang.org/")) {
    return "typescript-docs";
  }

  return "bun-docs";
}

function citationMapFor(recommendations: readonly Recommendation[], generatedAt: string): AgentCitationMap {
  const citations: AgentCitationMap = {};

  for (const source of recommendations.flatMap((recommendation) => recommendation.sources)) {
    citations[citationIdForSource(source)] = {
      title: titleForSource(source),
      url: source,
      sourceType: sourceTypeFor(source),
      fetchedAt: generatedAt
    };
  }

  return citations;
}

function validationCommands(scripts: Record<string, string>, focus: Focus): string[] {
  const commands = new Set<string>();

  if (focus === "all" || focus === "tests") {
    commands.add(scripts.test ?? "bun test");
  }

  if ((focus === "all" || focus === "typescript") && scripts.typecheck !== undefined) {
    commands.add(scripts.typecheck);
  }

  if ((focus === "all" || focus === "dependencies") && scripts.build !== undefined) {
    commands.add(scripts.build);
  }

  return [...commands];
}

function summaryFor(profile: ProjectProfile, findingsCount: number, topTitle?: string): string {
  const findingText = findingsCount === 1 ? "1 Bun finding" : `${findingsCount} Bun findings`;
  const topIssue = topTitle === undefined ? "" : ` Top issue: ${topTitle}.`;
  return `${profile.name} uses ${profile.packageManager} with ${profile.sourceFileCount} source file(s), ${profile.testFileCount} test file(s), and ${findingText}.${topIssue}`;
}

function localProjectCitation(generatedAt: string): AgentCitation {
  return {
    title: "Local project",
    url: "local-project:project",
    sourceType: "local-project",
    fetchedAt: generatedAt
  };
}

function fileHashesFor(analysis: AnalyzeBunProjectSuccess): FindingProjectFileHash[] {
  return analysis.sourceAnalysis.discovery.files.map((file) => {
    try {
      return {
        relativePath: file.relativePath,
        contentHash: computeContentHash(readFileSync(file.path, "utf8"))
      };
    } catch {
      return {
        relativePath: file.relativePath,
        contentHash: "unavailable"
      };
    }
  });
}

function deltaInvalidWarning(sinceToken: string): AgentWarning {
  return {
    id: "delta-token-invalid",
    title: "Delta token not applied",
    message: "The supplied delta token is invalid or expired. Returned a normal current response.",
    evidence: [`sinceToken=${sinceToken}`],
    citationIds: ["local-project"]
  };
}

export function projectHealth(input: unknown, dependencies: ProjectHealthDependencies = {}): ProjectHealthResult {
  const parsed = projectHealthInputSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      error: createInvalidInputError(parsed.error)
    };
  }

  const responseMode = parsed.data.responseMode ?? "brief";
  const focus = parsed.data.focus ?? "all";
  const analysis = analyzeBunProject(
    {
      projectPath: parsed.data.projectPath,
      forceRefresh: parsed.data.forceRefresh
    },
    dependencies
  );

  if (!analysis.ok) {
    return analysis;
  }

  const profile = projectProfile(analysis);
  const recommendations = analysis.recommendations.filter((recommendation) => matchesFocus(recommendation, focus));
  const citations = {
    "local-project": localProjectCitation(analysis.generatedAt),
    ...citationMapFor(recommendations, analysis.generatedAt)
  };
  const citationIdsBySource = Object.fromEntries(
    recommendations.flatMap((recommendation) =>
      recommendation.sources.map((source) => [source, citationIdForSource(source)] as const)
    )
  );
  const findings = normalizeRecommendationsToFindings(recommendations, {
    projectHash: analysis.projectHash,
    citationIdsBySource
  });
  const actions = [
    ...createActionsFromRecommendations(recommendations, findings),
    ...validationCommands(analysis.scripts, focus).map((command) =>
      createVerifyAction({
        id: `verify-${command.replace(/[^a-z0-9]+/giu, "-").replace(/^-|-$/gu, "").toLowerCase()}`,
        title: `Run ${command}`,
        command,
        reason: "Suggested validation command only; the MCP server does not execute it.",
        citationIds: ["local-project"],
        relatedFindingIds: []
      })
    )
  ];
  const deltaStore = dependencies.deltaStore ?? defaultFindingDeltaStore;
  const deltaResult = parsed.data.sinceToken === undefined ? null : deltaStore.compare(parsed.data.sinceToken, findings);
  const currentFindings = deltaResult?.valid === true ? deltaResult.currentFindings : findings;
  const warnings =
    parsed.data.sinceToken === undefined || deltaResult?.valid === true ? [] : [deltaInvalidWarning(parsed.data.sinceToken)];
  const deltaToken = deltaStore.createToken(findings);
  const envelope: AgentResponseEnvelope = {
    ok: true,
    schemaVersion: "agent-output-v1",
    generatedAt: analysis.generatedAt,
    responseMode,
    summary: summaryFor(profile, findings.length, findings[0]?.title),
    cacheStatus: analysis.cacheStatus,
    confidence: analysis.confidence,
    findings: currentFindings,
    actions,
    examples: [],
    citations,
    warnings,
    detailResource: `bun-project://analysis/${analysis.projectHash}`,
    projectHash: analysis.projectHash,
    deltaToken,
    ...(deltaResult?.valid === true ? { delta: deltaResult.delta } : {})
  };
  dependencies.findingCache?.setProjectSnapshot({
    projectHash: analysis.projectHash,
    projectPath: analysis.projectPath,
    generatedAt: analysis.generatedAt,
    schemaVersion: "agent-output-v1",
    findings,
    citations,
    fileHashes: fileHashesFor(analysis),
    warnings
  });

  return {
    ...applyResponseBudget(envelope),
    projectProfile: profile
  };
}
