import * as z from "zod/v4";
import type { FindingCacheStore, FindingProjectFileHash } from "../cache/finding-cache";
import type { AgentCitationMap, AgentFinding, AgentWarning } from "../shared/agent-output";
import type { CacheStatus } from "../shared/contracts";
import { createInvalidInputError, createNoEvidenceError, type StructuredError } from "../shared/errors";
import { isProjectHash } from "../shared/project-hash";

export const BUN_PROJECT_FINDINGS_RESOURCE_URI_TEMPLATE = "bun-project://findings/{projectHash}";

export interface ProjectFindingsResourceDescriptor {
  readonly uriTemplate: string;
  readonly name: string;
  readonly description: string;
  readonly mimeType: "application/json";
}

export const bunProjectFindingsResourceTemplate: ProjectFindingsResourceDescriptor = {
  uriTemplate: BUN_PROJECT_FINDINGS_RESOURCE_URI_TEMPLATE,
  name: "bun-project-findings",
  description: "Latest cached V2 normalized findings for a local project path hash.",
  mimeType: "application/json"
};

const projectFindingsResourceInputSchema = z
  .object({
    projectHash: z.string().refine(isProjectHash, {
      message: "Expected a lowercase SHA-256 project path hash"
    })
  })
  .strict();

export interface BunProjectFindingsResourceSuccess {
  readonly ok: true;
  readonly uri: string;
  readonly uriTemplate: typeof BUN_PROJECT_FINDINGS_RESOURCE_URI_TEMPLATE;
  readonly projectHash: string;
  readonly projectPath: string;
  readonly generatedAt: string;
  readonly schemaVersion: string;
  readonly findings: AgentFinding[];
  readonly citations: AgentCitationMap;
  readonly fileHashes: FindingProjectFileHash[];
  readonly cacheStatus: Extract<CacheStatus, "fresh">;
  readonly warnings: AgentWarning[];
}

export interface BunProjectFindingsResourceFailure {
  readonly ok: false;
  readonly uriTemplate: typeof BUN_PROJECT_FINDINGS_RESOURCE_URI_TEMPLATE;
  readonly error: StructuredError;
}

export type BunProjectFindingsResourceResult = BunProjectFindingsResourceSuccess | BunProjectFindingsResourceFailure;

export interface BunProjectFindingsResourceDependencies {
  readonly store: FindingCacheStore;
}

export function readBunProjectFindingsResource(
  input: unknown,
  dependencies: BunProjectFindingsResourceDependencies
): BunProjectFindingsResourceResult {
  const parsed = projectFindingsResourceInputSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      uriTemplate: BUN_PROJECT_FINDINGS_RESOURCE_URI_TEMPLATE,
      error: createInvalidInputError(parsed.error)
    };
  }

  const snapshot = dependencies.store.getProjectSnapshot(parsed.data.projectHash);

  if (snapshot === null) {
    return {
      ok: false,
      uriTemplate: BUN_PROJECT_FINDINGS_RESOURCE_URI_TEMPLATE,
      error: createNoEvidenceError({
        reason: `No cached normalized findings exist for hash ${parsed.data.projectHash}.`
      })
    };
  }

  return {
    ok: true,
    uri: `bun-project://findings/${snapshot.projectHash}`,
    uriTemplate: BUN_PROJECT_FINDINGS_RESOURCE_URI_TEMPLATE,
    projectHash: snapshot.projectHash,
    projectPath: snapshot.projectPath,
    generatedAt: snapshot.generatedAt,
    schemaVersion: snapshot.schemaVersion,
    findings: snapshot.findings,
    citations: snapshot.citations,
    fileHashes: snapshot.fileHashes,
    cacheStatus: "fresh",
    warnings: snapshot.warnings
  };
}
