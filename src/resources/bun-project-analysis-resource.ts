import * as z from "zod/v4";
import type { AnalyzeBunProjectSuccess } from "../tools/analyze-bun-project";
import type { CacheStatus, ResponseWarning } from "../shared/contracts";
import { createInvalidInputError, type StructuredError } from "../shared/errors";
import { isProjectHash, type ProjectAnalysisStore, type ProjectSourceFileHash } from "./project-analysis-store";

export const BUN_PROJECT_ANALYSIS_RESOURCE_URI_TEMPLATE = "bun-project://analysis/{projectHash}";

export interface ProjectAnalysisResourceDescriptor {
  readonly uriTemplate: string;
  readonly name: string;
  readonly description: string;
  readonly mimeType: "application/json";
}

export const bunProjectAnalysisResourceTemplate: ProjectAnalysisResourceDescriptor = {
  uriTemplate: BUN_PROJECT_ANALYSIS_RESOURCE_URI_TEMPLATE,
  name: "bun-project-analysis",
  description: "Latest cached read-only analysis for a local project path hash.",
  mimeType: "application/json"
};

const projectAnalysisResourceInputSchema = z
  .object({
    projectHash: z.string().refine(isProjectHash, {
      message: "Expected a lowercase SHA-256 project path hash"
    })
  })
  .strict();

export interface BunProjectAnalysisResourceSuccess {
  readonly ok: true;
  readonly uri: string;
  readonly uriTemplate: typeof BUN_PROJECT_ANALYSIS_RESOURCE_URI_TEMPLATE;
  readonly projectHash: string;
  readonly projectPath: string;
  readonly generatedAt: string;
  readonly analysis: AnalyzeBunProjectSuccess;
  readonly sourceFileCount: number;
  readonly fileHashes: ProjectSourceFileHash[];
  readonly cacheStatus: Extract<CacheStatus, "fresh" | "stale">;
  readonly warnings: ResponseWarning[];
}

export interface BunProjectAnalysisResourceFailure {
  readonly ok: false;
  readonly uriTemplate: typeof BUN_PROJECT_ANALYSIS_RESOURCE_URI_TEMPLATE;
  readonly error: StructuredError;
}

export type BunProjectAnalysisResourceResult =
  | BunProjectAnalysisResourceSuccess
  | BunProjectAnalysisResourceFailure;

export interface BunProjectAnalysisResourceDependencies {
  readonly store: ProjectAnalysisStore;
  readonly now?: () => string;
}

export function listBunProjectAnalysisResources(): readonly ProjectAnalysisResourceDescriptor[] {
  return [bunProjectAnalysisResourceTemplate];
}

export function readBunProjectAnalysisResource(
  input: unknown,
  dependencies: BunProjectAnalysisResourceDependencies
): BunProjectAnalysisResourceResult {
  const parsed = projectAnalysisResourceInputSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      uriTemplate: BUN_PROJECT_ANALYSIS_RESOURCE_URI_TEMPLATE,
      error: createInvalidInputError(parsed.error)
    };
  }

  const lookup = dependencies.store.lookup(parsed.data.projectHash, dependencies.now?.());

  if (!lookup.ok) {
    return {
      ok: false,
      uriTemplate: BUN_PROJECT_ANALYSIS_RESOURCE_URI_TEMPLATE,
      error: lookup.error
    };
  }

  return {
    ok: true,
    uri: `bun-project://analysis/${lookup.snapshot.projectHash}`,
    uriTemplate: BUN_PROJECT_ANALYSIS_RESOURCE_URI_TEMPLATE,
    projectHash: lookup.snapshot.projectHash,
    projectPath: lookup.snapshot.projectPath,
    generatedAt: lookup.snapshot.generatedAt,
    analysis: lookup.snapshot.analysis,
    sourceFileCount: lookup.snapshot.fileHashes.length,
    fileHashes: lookup.snapshot.fileHashes,
    cacheStatus: lookup.cacheStatus,
    warnings: lookup.warnings
  };
}
