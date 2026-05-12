import * as z from "zod/v4";
import { analyzeLockfiles } from "../analyzers/lockfiles";
import { createDependencyPlan, type DependencyType } from "../recommendations/dependency-plan";
import type { Confidence, ResponseWarning } from "../shared/contracts";
import { createInvalidInputError, type StructuredError } from "../shared/errors";
import { resolveProjectRoot } from "../security/project-paths";
import type { NpmRegistryAdapter, NpmPackageMetadata } from "../sources/npm-registry";

const packageRequestSchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(/^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/iu),
  requestedRange: z.string().min(1).optional()
});

const planInputSchema = z
  .object({
    projectPath: z.string().min(1),
    packages: z.array(packageRequestSchema).min(1),
    dependencyType: z.enum(["dependencies", "devDependencies", "optionalDependencies"]).optional()
  })
  .strict();

export interface PlanBunDependencyDependencies {
  readonly registryAdapter: NpmRegistryAdapter;
}

export interface PlanBunDependencyFailure {
  readonly ok: false;
  readonly error: StructuredError;
}

export type PlanBunDependencySuccess = ReturnType<typeof createDependencyPlan> & {
  readonly ok: true;
  readonly generatedAt: string;
  readonly confidence: Confidence;
  readonly warnings: ResponseWarning[];
  readonly packageManager: string;
};

export type PlanBunDependencyResult = PlanBunDependencySuccess | PlanBunDependencyFailure;

function nonBunWarning(packageManager: string): ResponseWarning {
  return {
    id: "dependency-plan-non-bun-project",
    title: "Project is not clearly Bun-first",
    detail: `Dependency command still uses Bun as requested, but lockfile evidence indicates packageManager=${packageManager}.`,
    evidence: [`packageManager=${packageManager}`],
    sources: ["local-project:lockfiles"]
  };
}

export async function planBunDependency(
  input: unknown,
  dependencies: PlanBunDependencyDependencies
): Promise<PlanBunDependencyResult> {
  const parsed = planInputSchema.safeParse(input);

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

  const metadata: NpmPackageMetadata[] = [];

  for (const packageRequest of parsed.data.packages) {
    const result = await dependencies.registryAdapter.fetchPackageMetadata(packageRequest.name);

    if (!result.ok) {
      return result;
    }

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
  const warnings = packageManager === "bun" ? [] : [nonBunWarning(packageManager)];

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    ...plan,
    packageManager,
    confidence: warnings.length === 0 ? "high" : "medium",
    warnings
  };
}
