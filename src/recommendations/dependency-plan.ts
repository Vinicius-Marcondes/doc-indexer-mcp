import type { Recommendation, SourceCitation } from "../shared/contracts";
import type { NpmPackageMetadata, NpmVersionMetadata } from "../sources/npm-registry";

export type DependencyType = "dependencies" | "devDependencies" | "optionalDependencies";

export interface DependencyPlanPackageInput {
  readonly name: string;
  readonly requestedRange?: string;
  readonly metadata: NpmPackageMetadata;
}

export interface DependencyPlanInput {
  readonly dependencyType: DependencyType;
  readonly packages: DependencyPlanPackageInput[];
}

export interface PlannedDependency {
  readonly name: string;
  readonly requestedRange?: string;
  readonly selectedVersion?: string;
}

export interface DependencyPlan {
  readonly installCommand: string;
  readonly packages: PlannedDependency[];
  readonly metadata: NpmPackageMetadata[];
  readonly peerDependencyWarnings: Recommendation[];
  readonly engineWarnings: Recommendation[];
  readonly deprecationWarnings: Recommendation[];
  readonly workspaceNotes: string[];
  readonly recommendations: Recommendation[];
  readonly sources: SourceCitation[];
}

function commandPrefix(dependencyType: DependencyType): string {
  if (dependencyType === "devDependencies") {
    return "bun add -d";
  }

  if (dependencyType === "optionalDependencies") {
    return "bun add --optional";
  }

  return "bun add";
}

function packageToken(input: DependencyPlanPackageInput): string {
  return input.requestedRange === undefined ? input.name : `${input.name}@${input.requestedRange}`;
}

function selectedVersion(input: DependencyPlanPackageInput): string | undefined {
  if (input.requestedRange !== undefined && input.metadata.versions[input.requestedRange] !== undefined) {
    return input.requestedRange;
  }

  return input.metadata.latestVersion;
}

function selectedMetadata(input: DependencyPlanPackageInput): NpmVersionMetadata | undefined {
  const version = selectedVersion(input);
  return version === undefined ? undefined : input.metadata.versions[version];
}

function sourceFor(metadata: NpmPackageMetadata): SourceCitation {
  return {
    title: `npm: ${metadata.name}`,
    url: metadata.sourceUrl,
    sourceType: "npm-registry",
    fetchedAt: metadata.fetchedAt
  };
}

function sourceUrls(input: DependencyPlanPackageInput): string[] {
  return [input.metadata.sourceUrl];
}

function deprecationWarning(input: DependencyPlanPackageInput): Recommendation | null {
  const version = selectedVersion(input);
  const versionMetadata = selectedMetadata(input);

  if (version === undefined || versionMetadata?.deprecated === undefined) {
    return null;
  }

  return {
    id: `dependency-deprecated-${input.name}-${version}`,
    severity: "warning",
    title: `${input.name}@${version} is deprecated`,
    detail: versionMetadata.deprecated,
    evidence: [`${input.name}@${version} is deprecated: ${versionMetadata.deprecated}`],
    sources: sourceUrls(input),
    recommendedAction: "Review npm registry deprecation metadata before installing."
  };
}

function peerDependencyWarning(input: DependencyPlanPackageInput): Recommendation | null {
  const version = selectedVersion(input);
  const versionMetadata = selectedMetadata(input);
  const peers = Object.entries(versionMetadata?.peerDependencies ?? {});

  if (version === undefined || peers.length === 0) {
    return null;
  }

  const peerList = peers.map(([name, range]) => `${name}@${range}`).join(", ");

  return {
    id: `dependency-peer-review-${input.name}-${version}`,
    severity: "warning",
    title: `${input.name}@${version} has peer dependencies`,
    detail: `Review peer dependency requirements before installing: ${peerList}.`,
    evidence: [`npm metadata peerDependencies for ${input.name}@${version}: ${peerList}`],
    sources: sourceUrls(input),
    recommendedAction: "Compare peer requirements with the project dependency graph before editing package files."
  };
}

function engineWarning(input: DependencyPlanPackageInput): Recommendation | null {
  const version = selectedVersion(input);
  const versionMetadata = selectedMetadata(input);
  const engines = Object.entries(versionMetadata?.engines ?? {});

  if (version === undefined || engines.length === 0) {
    return null;
  }

  const engineList = engines.map(([name, range]) => `${name}@${range}`).join(", ");

  return {
    id: `dependency-engine-review-${input.name}-${version}`,
    severity: "warning",
    title: `${input.name}@${version} declares engine requirements`,
    detail: `Review engine requirements before installing: ${engineList}.`,
    evidence: [`npm metadata engines for ${input.name}@${version}: ${engineList}`],
    sources: sourceUrls(input),
    recommendedAction: "Verify the local Bun/runtime version satisfies package engine metadata."
  };
}

export function createDependencyPlan(input: DependencyPlanInput): DependencyPlan {
  const installCommand = `${commandPrefix(input.dependencyType)} ${input.packages.map(packageToken).join(" ")}`;
  const packages = input.packages.map((dependency) => ({
    name: dependency.name,
    ...(dependency.requestedRange === undefined ? {} : { requestedRange: dependency.requestedRange }),
    ...(selectedVersion(dependency) === undefined ? {} : { selectedVersion: selectedVersion(dependency) })
  }));
  const deprecationWarnings = input.packages.map(deprecationWarning).filter((warning): warning is Recommendation => warning !== null);
  const peerDependencyWarnings = input.packages
    .map(peerDependencyWarning)
    .filter((warning): warning is Recommendation => warning !== null);
  const engineWarnings = input.packages.map(engineWarning).filter((warning): warning is Recommendation => warning !== null);

  return {
    installCommand,
    packages,
    metadata: input.packages.map((dependency) => dependency.metadata),
    peerDependencyWarnings,
    engineWarnings,
    deprecationWarnings,
    workspaceNotes: [],
    recommendations: [
      {
        id: "bun-native-install-command",
        severity: "info",
        title: "Use Bun to add dependencies",
        detail: `Recommended command: ${installCommand}. The MCP server did not install packages or mutate files.`,
        evidence: ["Bun-native dependency command selected for a Bun-first project."],
        sources: input.packages.map((dependency) => dependency.metadata.sourceUrl),
        recommendedAction: installCommand
      }
    ],
    sources: input.packages.map((dependency) => sourceFor(dependency.metadata))
  };
}
