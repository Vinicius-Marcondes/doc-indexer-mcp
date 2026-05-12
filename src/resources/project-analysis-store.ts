import { readFileSync } from "node:fs";
import type { AnalyzeBunProjectSuccess } from "../tools/analyze-bun-project";
import { discoverSourceFiles } from "../analyzers/source-discovery";
import { computeContentHash } from "../cache/sqlite-cache";
import type { CacheStatus, ResponseWarning } from "../shared/contracts";
import { createNoEvidenceError, type StructuredError } from "../shared/errors";
import { hashProjectPath as hashPath } from "../shared/project-hash";

const DEFAULT_ANALYSIS_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_ANALYSIS_ERROR_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export { isProjectHash } from "../shared/project-hash";

export interface ProjectSourceFileHash {
  readonly relativePath: string;
  readonly size: number;
  readonly contentHash: string;
}

export interface ProjectAnalysisSnapshot {
  readonly projectHash: string;
  readonly projectPath: string;
  readonly generatedAt: string;
  readonly analysis: AnalyzeBunProjectSuccess;
  readonly fileHashes: ProjectSourceFileHash[];
}

export interface ProjectAnalysisStoreOptions {
  readonly now?: () => string;
  readonly ttlMs?: number;
  readonly errorAfterMs?: number;
}

export interface ProjectAnalysisLookupSuccess {
  readonly ok: true;
  readonly snapshot: ProjectAnalysisSnapshot;
  readonly cacheStatus: Extract<CacheStatus, "fresh" | "stale">;
  readonly warnings: ResponseWarning[];
}

export interface ProjectAnalysisLookupFailure {
  readonly ok: false;
  readonly error: StructuredError;
}

export type ProjectAnalysisLookup = ProjectAnalysisLookupSuccess | ProjectAnalysisLookupFailure;

function fileHashesFor(projectPath: string): ProjectSourceFileHash[] {
  return discoverSourceFiles(projectPath).files.map((file) => {
    try {
      return {
        relativePath: file.relativePath,
        size: file.size,
        contentHash: computeContentHash(readFileSync(file.path, "utf8"))
      };
    } catch {
      return {
        relativePath: file.relativePath,
        size: file.size,
        contentHash: "unavailable"
      };
    }
  });
}

function signatureFor(fileHashes: readonly ProjectSourceFileHash[]): string {
  return JSON.stringify(
    fileHashes.map((file) => ({
      relativePath: file.relativePath,
      size: file.size,
      contentHash: file.contentHash
    }))
  );
}

function staleWarning(snapshot: ProjectAnalysisSnapshot, reasons: readonly string[]): ResponseWarning {
  return {
    id: "project-analysis-stale",
    title: "Cached project analysis is stale",
    detail: `Cached analysis for ${snapshot.projectPath} is stale: ${reasons.join(", ")}.`,
    evidence: [`projectHash=${snapshot.projectHash}`, `generatedAt=${snapshot.generatedAt}`, ...reasons],
    sources: [`local-project:${snapshot.projectPath}`]
  };
}

export function hashProjectPath(projectPath: string): string {
  return hashPath(projectPath);
}

export class ProjectAnalysisStore {
  private readonly snapshots = new Map<string, ProjectAnalysisSnapshot>();
  private readonly now: () => string;
  private readonly ttlMs: number;
  private readonly errorAfterMs: number;

  constructor(options: ProjectAnalysisStoreOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.ttlMs = options.ttlMs ?? DEFAULT_ANALYSIS_TTL_MS;
    this.errorAfterMs = options.errorAfterMs ?? DEFAULT_ANALYSIS_ERROR_AFTER_MS;
  }

  set(analysis: AnalyzeBunProjectSuccess): ProjectAnalysisSnapshot {
    const projectHash = analysis.projectHash;
    const snapshot: ProjectAnalysisSnapshot = {
      projectHash,
      projectPath: analysis.projectPath,
      generatedAt: analysis.generatedAt,
      analysis,
      fileHashes: fileHashesFor(analysis.projectPath)
    };

    this.snapshots.set(projectHash, snapshot);
    return snapshot;
  }

  get(projectHash: string): ProjectAnalysisSnapshot | null {
    return this.snapshots.get(projectHash) ?? null;
  }

  lookup(projectHash: string, now: string = this.now()): ProjectAnalysisLookup {
    const snapshot = this.get(projectHash);

    if (snapshot === null) {
      return {
        ok: false,
        error: createNoEvidenceError({
          reason: `No cached project analysis exists for hash ${projectHash}.`
        })
      };
    }

    const ageMs = Date.parse(now) - Date.parse(snapshot.generatedAt);

    if (ageMs > this.errorAfterMs) {
      return {
        ok: false,
        error: createNoEvidenceError({
          sourceUrl: `local-project:${snapshot.projectPath}`,
          reason: `Cached analysis is older than the ${this.errorAfterMs}ms retention policy.`
        })
      };
    }

    const currentFileHashes = fileHashesFor(snapshot.projectPath);
    const staleReasons: string[] = [];

    if (ageMs > this.ttlMs) {
      staleReasons.push("analysis_ttl_expired");
    }

    if (signatureFor(currentFileHashes) !== signatureFor(snapshot.fileHashes)) {
      staleReasons.push("source_files_changed");
    }

    return {
      ok: true,
      snapshot,
      cacheStatus: staleReasons.length === 0 ? "fresh" : "stale",
      warnings: staleReasons.length === 0 ? [] : [staleWarning(snapshot, staleReasons)]
    };
  }
}
