import type { CacheStatus, Confidence, ResponseWarning, SourceCitation } from "../shared/contracts";
import { createStructuredError, type StructuredError } from "../shared/errors";
import type { CacheEntry, SqliteCacheStore } from "../cache/sqlite-cache";
import type { SourceFetchClient } from "./fetch-client";

const NPM_METADATA_TTL_MS = 60 * 60 * 1000;

export interface NpmVersionMetadata {
  readonly version: string;
  readonly deprecated?: string;
  readonly peerDependencies: Record<string, string>;
  readonly engines: Record<string, string>;
  readonly publishedAt?: string;
}

export interface NpmDeprecation {
  readonly version: string;
  readonly message: string;
}

export interface NpmPackageMetadata {
  readonly name: string;
  readonly sourceUrl: string;
  readonly fetchedAt: string;
  readonly distTags: Record<string, string>;
  readonly latestVersion?: string;
  readonly versions: Record<string, NpmVersionMetadata>;
  readonly deprecations: NpmDeprecation[];
  readonly time: Record<string, string>;
}

export interface NpmRegistrySuccess {
  readonly ok: true;
  readonly metadata: NpmPackageMetadata;
  readonly cacheStatus: Extract<CacheStatus, "fresh" | "stale">;
  readonly confidence: Confidence;
  readonly warnings: ResponseWarning[];
  readonly sources: SourceCitation[];
}

export interface NpmRegistryFailure {
  readonly ok: false;
  readonly error: StructuredError;
}

export type NpmRegistryResult = NpmRegistrySuccess | NpmRegistryFailure;

export interface NpmRegistryAdapterOptions {
  readonly cache: SqliteCacheStore;
  readonly fetchClient: SourceFetchClient;
  readonly now?: () => string;
  readonly ttlMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
}

function expiresAt(now: string, ttlMs: number): string {
  return new Date(Date.parse(now) + ttlMs).toISOString();
}

function registryWarning(cacheStatus: "fresh" | "stale", entry: CacheEntry, reason: string): ResponseWarning {
  return {
    id: `npm-registry-fetch-failed-${cacheStatus}-cache-used`,
    title:
      cacheStatus === "fresh"
        ? "Using fresh npm registry cache because live fetch failed"
        : "Using stale npm registry cache because live fetch failed",
    detail: `Live npm registry fetch failed: ${reason}. Returned ${cacheStatus} cache entry fetched at ${entry.fetchedAt}.`,
    evidence: [`cacheStatus=${cacheStatus}`, `fetchedAt=${entry.fetchedAt}`, `expiresAt=${entry.expiresAt}`],
    sources: entry.sourceUrl === undefined ? [entry.key] : [entry.sourceUrl]
  };
}

function parseFailure(reason: string): NpmRegistryFailure {
  return {
    ok: false,
    error: createStructuredError("parse_failed", "npm registry metadata could not be parsed.", { reason })
  };
}

function citationFor(metadata: NpmPackageMetadata): SourceCitation {
  return {
    title: `npm: ${metadata.name}`,
    url: metadata.sourceUrl,
    sourceType: "npm-registry",
    fetchedAt: metadata.fetchedAt
  };
}

function successFromEntry(
  entry: CacheEntry,
  cacheStatus: "fresh" | "stale",
  confidence: Confidence,
  warnings: ResponseWarning[]
): NpmRegistryResult {
  try {
    const metadata = parseNpmPackageMetadata(entry.content, entry.sourceUrl ?? entry.key, entry.fetchedAt);

    return {
      ok: true,
      metadata,
      cacheStatus,
      confidence,
      warnings,
      sources: [citationFor(metadata)]
    };
  } catch (error) {
    return parseFailure(error instanceof Error ? error.message : "unknown parse failure");
  }
}

export function npmRegistryPackageUrl(packageName: string): string {
  return `https://registry.npmjs.org/${encodeURIComponent(packageName)}`;
}

export function parseNpmPackageMetadata(content: string, sourceUrl: string, fetchedAt: string): NpmPackageMetadata {
  const raw = JSON.parse(content) as unknown;

  if (!isRecord(raw) || typeof raw.name !== "string") {
    throw new Error("metadata missing package name");
  }

  const distTags = stringRecord(raw["dist-tags"]);
  const versionRecords = isRecord(raw.versions) ? raw.versions : {};
  const time = stringRecord(raw.time);
  const versions: Record<string, NpmVersionMetadata> = {};
  const deprecations: NpmDeprecation[] = [];

  for (const [version, value] of Object.entries(versionRecords)) {
    if (!isRecord(value)) {
      continue;
    }

    const deprecated = typeof value.deprecated === "string" && value.deprecated.length > 0 ? value.deprecated : undefined;

    versions[version] = {
      version,
      ...(deprecated === undefined ? {} : { deprecated }),
      peerDependencies: stringRecord(value.peerDependencies),
      engines: stringRecord(value.engines),
      ...(time[version] === undefined ? {} : { publishedAt: time[version] })
    };

    if (deprecated !== undefined) {
      deprecations.push({
        version,
        message: deprecated
      });
    }
  }

  return {
    name: raw.name,
    sourceUrl,
    fetchedAt,
    distTags,
    ...(distTags.latest === undefined ? {} : { latestVersion: distTags.latest }),
    versions,
    deprecations,
    time
  };
}

export class NpmRegistryAdapter {
  private readonly cache: SqliteCacheStore;
  private readonly fetchClient: SourceFetchClient;
  private readonly now: () => string;
  private readonly ttlMs: number;

  constructor(options: NpmRegistryAdapterOptions) {
    this.cache = options.cache;
    this.fetchClient = options.fetchClient;
    this.now = options.now ?? (() => new Date().toISOString());
    this.ttlMs = options.ttlMs ?? NPM_METADATA_TTL_MS;
  }

  async fetchPackageMetadata(packageName: string): Promise<NpmRegistryResult> {
    const sourceUrl = npmRegistryPackageUrl(packageName);
    const now = this.now();
    const fetched = await this.fetchClient.fetchText(sourceUrl);

    if (fetched.ok) {
      const entry = this.cache.set({
        key: sourceUrl,
        sourceType: "npm-registry",
        sourceUrl,
        content: fetched.body,
        fetchedAt: fetched.fetchedAt,
        expiresAt: expiresAt(now, this.ttlMs),
        status: String(fetched.status)
      });

      return successFromEntry(entry, "fresh", "high", []);
    }

    const cached = this.cache.get(sourceUrl, "npm-registry", now);

    if (cached.cacheStatus === "miss") {
      return {
        ok: false,
        error: fetched.error
      };
    }

    return successFromEntry(
      cached.entry,
      cached.cacheStatus,
      cached.cacheStatus === "fresh" ? "medium" : "low",
      [registryWarning(cached.cacheStatus, cached.entry, fetched.error.message)]
    );
  }
}
