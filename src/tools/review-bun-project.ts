import { basename } from "node:path";
import * as z from "zod/v4";
import type { Recommendation, ResponseWarning, SourceCitation, Confidence } from "../shared/contracts";
import { createInvalidInputError, type StructuredError } from "../shared/errors";
import { analyzeBunProject } from "./analyze-bun-project";

const focusSchema = z.enum(["typescript", "dependencies", "tests", "lockfile", "runtime", "all"]);

const reviewInputSchema = z
  .object({
    projectPath: z.string().min(1),
    focus: focusSchema.optional()
  })
  .strict();

export interface ProjectProfile {
  readonly name: string;
  readonly packageManager: string;
  readonly lockfiles: string[];
  readonly scripts: Record<string, string>;
  readonly dependencyCount: number;
  readonly devDependencyCount: number;
  readonly sourceFileCount: number;
  readonly testFileCount: number;
}

export interface ReviewBunProjectSuccess {
  readonly ok: true;
  readonly generatedAt: string;
  readonly summary: string;
  readonly projectProfile: ProjectProfile;
  readonly keyRisks: Array<ResponseWarning | Recommendation>;
  readonly recommendedNextActions: Recommendation[];
  readonly validationCommandsForAgent: string[];
  readonly sources: SourceCitation[];
  readonly confidence: Confidence;
  readonly warnings: ResponseWarning[];
}

export interface ReviewBunProjectFailure {
  readonly ok: false;
  readonly error: StructuredError;
}

export type ReviewBunProjectResult = ReviewBunProjectSuccess | ReviewBunProjectFailure;

type Focus = z.infer<typeof focusSchema>;

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
    return /runtime|bun-api|types-bun/u.test(recommendation.id);
  }

  return false;
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

function shouldIncludeDependencyCompatibilityWarning(focus: Focus): boolean {
  return focus === "all" || focus === "dependencies";
}

function dependencyCompatibilityWarning(): ResponseWarning {
  return {
    id: "dependency-latest-compatibility-warning",
    title: "Latest dependency version may not be compatible",
    detail: "Do not assume the latest npm dist-tag is compatible with this project. Check peer dependencies, engines, and project constraints before editing package files.",
    evidence: ["Dependency planning should verify npm metadata before recommending a package change."],
    sources: ["https://registry.npmjs.org/"]
  };
}

export function reviewBunProject(input: unknown): ReviewBunProjectResult {
  const parsed = reviewInputSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      error: createInvalidInputError(parsed.error)
    };
  }

  const focus = parsed.data.focus ?? "all";
  const analysis = analyzeBunProject({ projectPath: parsed.data.projectPath });

  if (!analysis.ok) {
    return analysis;
  }

  const projectName = analysis.packageJson.name ?? basename(analysis.projectPath);
  const focusedActions = analysis.recommendations.filter((recommendation) => matchesFocus(recommendation, focus));
  const warningRecommendations = analysis.recommendations.filter((recommendation) => recommendation.severity !== "info");
  const reviewWarnings = shouldIncludeDependencyCompatibilityWarning(focus)
    ? [...analysis.warnings, dependencyCompatibilityWarning()]
    : analysis.warnings;
  const keyRisks = [...reviewWarnings, ...warningRecommendations].slice(0, 8);

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    summary: `${projectName} appears to use ${analysis.packageManager.name} with ${analysis.sourceAnalysis.discovery.files.length} analyzable source file(s).`,
    projectProfile: {
      name: projectName,
      packageManager: analysis.packageManager.name,
      lockfiles: analysis.lockfiles.present,
      scripts: analysis.scripts,
      dependencyCount: Object.keys(analysis.dependencies).length,
      devDependencyCount: Object.keys(analysis.devDependencies).length,
      sourceFileCount: analysis.sourceAnalysis.discovery.files.length,
      testFileCount: analysis.testAnalysis.testFiles.length
    },
    keyRisks,
    recommendedNextActions: focusedActions,
    validationCommandsForAgent: validationCommands(analysis.scripts, focus),
    sources: analysis.sources,
    confidence: analysis.confidence,
    warnings: reviewWarnings
  };
}
