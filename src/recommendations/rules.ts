import type { BunGlobalAnalysis } from "../analyzers/ast-bun-globals";
import type { LockfileAnalysis } from "../analyzers/lockfiles";
import type { PackageJsonAnalysis } from "../analyzers/package-json";
import type { TestAnalysis } from "../analyzers/test-analysis";
import type { TsconfigAnalysis } from "../analyzers/tsconfig";
import type { Recommendation } from "../shared/contracts";

const bunTypeScriptDocs = "https://bun.com/docs/runtime/typescript";
const bunLockfileDocs = "https://bun.com/docs/pm/lockfile";
const bunTestDocs = "https://bun.com/docs/test";

export interface ProjectRecommendationInput {
  readonly packageJson?: PackageJsonAnalysis;
  readonly tsconfig?: TsconfigAnalysis;
  readonly lockfiles?: LockfileAnalysis;
  readonly bunGlobals?: BunGlobalAnalysis;
  readonly testAnalysis?: TestAnalysis;
}

function localSource(label: string): string {
  return `local-project:${label}`;
}

function bunGlobalEvidence(bunGlobals: BunGlobalAnalysis): string[] {
  return bunGlobals.findings.map((finding) => `Detected Bun.${finding.member} at ${finding.relativePath}:${finding.line}`);
}

function hasBunGlobalUsage(input: ProjectRecommendationInput): boolean {
  return (input.bunGlobals?.findings.length ?? 0) > 0;
}

function needsBunTypes(input: ProjectRecommendationInput): boolean {
  return hasBunGlobalUsage(input) || input.packageJson?.detected.hasTypesBun === true;
}

function missingTypesBunPackage(input: ProjectRecommendationInput): Recommendation | null {
  if (!hasBunGlobalUsage(input) || input.packageJson?.detected.hasTypesBun === true) {
    return null;
  }

  return {
    id: "missing-types-bun-package",
    severity: "warning",
    title: "Add @types/bun for Bun API usage",
    detail: "The project uses Bun globals but package.json does not include @types/bun.",
    evidence: bunGlobalEvidence(input.bunGlobals!),
    sources: [bunTypeScriptDocs, localSource("package.json"), localSource("sourceAnalysis")],
    recommendedAction: "Run bun add -d @types/bun before relying on Bun global types."
  };
}

function missingTsconfigBunTypes(input: ProjectRecommendationInput): Recommendation | null {
  if (!needsBunTypes(input) || input.tsconfig?.detected.hasBunTypes === true) {
    return null;
  }

  return {
    id: "missing-tsconfig-bun-types",
    severity: "warning",
    title: 'Add types: ["bun"] to tsconfig',
    detail: 'Bun types are needed, but compilerOptions.types does not include "bun".',
    evidence: ["compilerOptions.types does not include bun", ...bunGlobalEvidence(input.bunGlobals ?? { findings: [], usages: {}, warnings: [] })],
    sources: [bunTypeScriptDocs, localSource("tsconfig.json")],
    recommendedAction: 'Add "types": ["bun"] under compilerOptions when the project uses Bun APIs.'
  };
}

function compilerOptionRecommendation(input: ProjectRecommendationInput): Recommendation | null {
  if (!needsBunTypes(input) || input.tsconfig === undefined || !input.tsconfig.exists) {
    return null;
  }

  const options = input.tsconfig.compilerOptions;
  const divergent: string[] = [];

  if (options.moduleResolution !== "bundler") {
    divergent.push(`moduleResolution=${options.moduleResolution ?? "missing"}`);
  }

  if (!(options.module === "Preserve" || options.module === "preserve")) {
    divergent.push(`module=${options.module ?? "missing"}`);
  }

  if (!(options.target === "ESNext" || options.target === "esnext")) {
    divergent.push(`target=${options.target ?? "missing"}`);
  }

  if (options.noEmit !== true) {
    divergent.push(`noEmit=${String(options.noEmit ?? "missing")}`);
  }

  if (divergent.length === 0) {
    return null;
  }

  return {
    id: "bun-typescript-compiler-options",
    severity: "info",
    title: "Review Bun TypeScript compiler options",
    detail: "Bun's TypeScript guidance favors bundler resolution, preserved modules, ESNext target, and noEmit for type checking.",
    evidence: divergent,
    sources: [bunTypeScriptDocs, localSource("tsconfig.json")],
    recommendedAction: "Align tsconfig with Bun TypeScript guidance when compatible with the project."
  };
}

function legacyLockfileRecommendation(input: ProjectRecommendationInput): Recommendation | null {
  if (input.lockfiles?.lockfiles.bunLockb !== true || input.lockfiles.lockfiles.bunLock === true) {
    return null;
  }

  return {
    id: "legacy-bun-lockb",
    severity: "warning",
    title: "Migrate legacy bun.lockb",
    detail: "Only the legacy binary Bun lockfile was found.",
    evidence: ["Found bun.lockb"],
    sources: [bunLockfileDocs, localSource("bun.lockb")],
    recommendedAction: "Regenerate the current text bun.lock with Bun when the user approves dependency maintenance."
  };
}

function mixedLockfileRecommendation(input: ProjectRecommendationInput): Recommendation | null {
  const mixedWarning = input.lockfiles?.warnings.find((item) => item.id === "mixed-lockfiles");

  if (mixedWarning === undefined) {
    return null;
  }

  return {
    id: "mixed-lockfiles",
    severity: "warning",
    title: "Resolve mixed package-manager lockfiles",
    detail: mixedWarning.detail,
    evidence: mixedWarning.evidence,
    sources: [bunLockfileDocs, ...mixedWarning.sources],
    recommendedAction: "Confirm the intended package manager before changing dependencies."
  };
}

function bunTestScriptRecommendation(input: ProjectRecommendationInput): Recommendation | null {
  const testWarning = input.testAnalysis?.warnings.find((item) => item.id === "bun-test-missing-script");

  if (testWarning === undefined) {
    return null;
  }

  return {
    id: "bun-test-missing-script",
    severity: "warning",
    title: "Add a bun test script",
    detail: testWarning.detail,
    evidence: testWarning.evidence,
    sources: [bunTestDocs, ...testWarning.sources],
    recommendedAction: 'Add a package.json test script such as "bun test" if it matches project conventions.'
  };
}

export function generateProjectRecommendations(input: ProjectRecommendationInput): Recommendation[] {
  return [
    missingTypesBunPackage(input),
    missingTsconfigBunTypes(input),
    compilerOptionRecommendation(input),
    legacyLockfileRecommendation(input),
    mixedLockfileRecommendation(input),
    bunTestScriptRecommendation(input)
  ]
    .filter((recommendation): recommendation is Recommendation => recommendation !== null)
    .sort((left, right) => left.id.localeCompare(right.id));
}
