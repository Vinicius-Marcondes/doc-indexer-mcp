import * as z from "zod/v4";
import { analyzeBunGlobals } from "../analyzers/ast-bun-globals";
import { analyzeImports } from "../analyzers/ast-imports";
import { parseBunfig } from "../analyzers/bunfig";
import { analyzeLockfiles } from "../analyzers/lockfiles";
import { parsePackageJson, type PackageJsonAnalysis } from "../analyzers/package-json";
import { discoverSourceFiles } from "../analyzers/source-discovery";
import { analyzeTests } from "../analyzers/test-analysis";
import { parseTsconfig, type TsconfigAnalysis } from "../analyzers/tsconfig";
import { calculateConfidence } from "../recommendations/confidence";
import { generateProjectRecommendations } from "../recommendations/rules";
import type { CacheStatus, Confidence, Recommendation, ResponseWarning, SourceCitation } from "../shared/contracts";
import { createInvalidInputError, type StructuredError } from "../shared/errors";
import { hashProjectPath } from "../shared/project-hash";
import { resolveProjectRoot } from "../security/project-paths";

const analyzeBunProjectInputSchema = z
  .object({
    projectPath: z.string().min(1),
    forceRefresh: z.boolean().optional()
  })
  .strict();

export interface AnalyzeBunProjectInput {
  readonly projectPath?: unknown;
  readonly forceRefresh?: unknown;
}

export interface AnalyzeBunProjectSuccess {
  readonly ok: true;
  readonly projectHash: string;
  readonly generatedAt: string;
  readonly cacheStatus: CacheStatus;
  readonly sources: SourceCitation[];
  readonly confidence: Confidence;
  readonly projectPath: string;
  readonly packageManager: ReturnType<typeof analyzeLockfiles>["packageManager"];
  readonly lockfiles: ReturnType<typeof analyzeLockfiles>["lockfiles"];
  readonly packageJson: PackageJsonAnalysis;
  readonly workspaces: string[];
  readonly scripts: Record<string, string>;
  readonly dependencies: Record<string, string>;
  readonly devDependencies: Record<string, string>;
  readonly tsconfig: TsconfigAnalysis;
  readonly bunfig: ReturnType<typeof parseBunfig>["bunfig"];
  readonly sourceAnalysis: {
    readonly discovery: ReturnType<typeof discoverSourceFiles>;
    readonly imports: ReturnType<typeof analyzeImports>;
    readonly bunGlobals: ReturnType<typeof analyzeBunGlobals>;
  };
  readonly testAnalysis: ReturnType<typeof analyzeTests>;
  readonly risks: ResponseWarning[];
  readonly recommendations: Recommendation[];
  readonly warnings: ResponseWarning[];
}

export interface AnalyzeBunProjectFailure {
  readonly ok: false;
  readonly error: StructuredError;
}

export type AnalyzeBunProjectResult = AnalyzeBunProjectSuccess | AnalyzeBunProjectFailure;

export interface AnalyzeBunProjectDependencies {
  readonly now?: () => string;
  readonly analysisStore?: {
    readonly set: (analysis: AnalyzeBunProjectSuccess) => unknown;
  };
}

function localProjectSource(projectPath: string, generatedAt: string): SourceCitation {
  return {
    title: "Local project",
    url: `local-project:${projectPath}`,
    sourceType: "local-project",
    fetchedAt: generatedAt
  };
}

function officialSourceFor(url: string, generatedAt: string): SourceCitation | null {
  if (url === "https://bun.com/docs/runtime/typescript") {
    return {
      title: "Bun TypeScript docs",
      url,
      sourceType: "bun-docs",
      fetchedAt: generatedAt
    };
  }

  if (url === "https://bun.com/docs/pm/lockfile") {
    return {
      title: "Bun lockfile docs",
      url,
      sourceType: "bun-docs",
      fetchedAt: generatedAt
    };
  }

  if (url === "https://bun.com/docs/test") {
    return {
      title: "Bun test docs",
      url,
      sourceType: "bun-docs",
      fetchedAt: generatedAt
    };
  }

  return null;
}

function sourcesFor(projectPath: string, generatedAt: string, recommendations: Recommendation[]): SourceCitation[] {
  const sources = [localProjectSource(projectPath, generatedAt)];
  const seen = new Set(sources.map((source) => source.url));

  for (const recommendation of recommendations) {
    for (const sourceUrl of recommendation.sources) {
      if (seen.has(sourceUrl)) {
        continue;
      }

      const source = officialSourceFor(sourceUrl, generatedAt);

      if (source !== null) {
        sources.push(source);
        seen.add(source.url);
      }
    }
  }

  return sources;
}

export function analyzeBunProject(
  input: unknown,
  dependencies: AnalyzeBunProjectDependencies = {}
): AnalyzeBunProjectResult {
  const parsed = analyzeBunProjectInputSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      error: createInvalidInputError(parsed.error)
    };
  }

  const rootResult = resolveProjectRoot(parsed.data.projectPath);

  if (!rootResult.ok) {
    return {
      ok: false,
      error: rootResult.error
    };
  }

  const packageResult = parsePackageJson(rootResult.projectRoot);
  if (!packageResult.ok) {
    return { ok: false, error: packageResult.error };
  }

  const tsconfigResult = parseTsconfig(rootResult.projectRoot);
  if (!tsconfigResult.ok) {
    return { ok: false, error: tsconfigResult.error };
  }

  const generatedAt = dependencies.now?.() ?? new Date().toISOString();
  const projectHash = hashProjectPath(rootResult.projectRoot);
  const lockfiles = analyzeLockfiles(rootResult.projectRoot);
  const bunfig = parseBunfig(rootResult.projectRoot).bunfig;
  const discovery = discoverSourceFiles(rootResult.projectRoot);
  const imports = analyzeImports(discovery.files);
  const bunGlobals = analyzeBunGlobals(discovery.files);
  const testAnalysis = analyzeTests(rootResult.projectRoot);
  const recommendations = generateProjectRecommendations({
    packageJson: packageResult.packageJson,
    tsconfig: tsconfigResult.tsconfig,
    lockfiles,
    bunGlobals,
    testAnalysis
  });
  const officialSourceCount = new Set(
    recommendations.flatMap((recommendation) => recommendation.sources.filter((source) => source.startsWith("https://")))
  ).size;
  const confidence = calculateConfidence({
    cacheStatus: "disabled",
    officialSourceCount,
    localEvidenceCount: discovery.files.length + recommendations.length,
    partialProjectData: packageResult.packageJson.exists === false
  });
  const warnings = [
    ...lockfiles.warnings,
    ...tsconfigResult.tsconfig.warnings,
    ...bunfig.warnings,
    ...bunGlobals.warnings,
    ...testAnalysis.warnings,
    ...confidence.warnings
  ];

  const result: AnalyzeBunProjectSuccess = {
    ok: true,
    projectHash,
    generatedAt,
    cacheStatus: "disabled",
    sources: sourcesFor(rootResult.projectRoot, generatedAt, recommendations),
    confidence: confidence.confidence,
    projectPath: rootResult.projectRoot,
    packageManager: lockfiles.packageManager,
    lockfiles: lockfiles.lockfiles,
    packageJson: packageResult.packageJson,
    workspaces: packageResult.packageJson.workspaces,
    scripts: packageResult.packageJson.scripts,
    dependencies: packageResult.packageJson.dependencies,
    devDependencies: packageResult.packageJson.devDependencies,
    tsconfig: tsconfigResult.tsconfig,
    bunfig,
    sourceAnalysis: {
      discovery,
      imports,
      bunGlobals
    },
    testAnalysis,
    risks: warnings,
    recommendations,
    warnings
  };

  dependencies.analysisStore?.set(result);
  return result;
}
