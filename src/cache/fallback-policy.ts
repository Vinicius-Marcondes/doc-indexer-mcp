import type { CacheStatus, Confidence, ResponseWarning, SourceType } from "../shared/contracts";
import { createNoEvidenceError, type StructuredError } from "../shared/errors";
import type { CacheEntry, SqliteCacheStore } from "./sqlite-cache";

export interface FreshFetchResult {
  readonly content: string;
  readonly status?: string;
  readonly sourceUrl?: string;
}

export interface CacheFallbackInput {
  readonly cache: SqliteCacheStore;
  readonly key: string;
  readonly sourceType: SourceType;
  readonly sourceUrl?: string;
  readonly now: string;
  readonly ttlMs: number;
  readonly fetchFresh: () => Promise<FreshFetchResult>;
}

export interface CacheFallbackSuccess {
  readonly ok: true;
  readonly content: string;
  readonly cacheStatus: Extract<CacheStatus, "fresh" | "stale">;
  readonly confidence: Confidence;
  readonly warnings: ResponseWarning[];
  readonly entry: CacheEntry;
}

export interface CacheFallbackFailure {
  readonly ok: false;
  readonly error: StructuredError;
}

export type CacheFallbackResult = CacheFallbackSuccess | CacheFallbackFailure;

function errorReason(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  return "unknown fetch failure";
}

function expiresAt(now: string, ttlMs: number): string {
  return new Date(Date.parse(now) + ttlMs).toISOString();
}

function cacheWarning(cacheStatus: "fresh" | "stale", entry: CacheEntry, reason: string): ResponseWarning {
  return {
    id: `live-fetch-failed-${cacheStatus}-cache-used`,
    title:
      cacheStatus === "fresh"
        ? "Using fresh cache because live fetch failed"
        : "Using stale cache because live fetch failed",
    detail: `Live fetch failed: ${reason}. Returned ${cacheStatus} cache entry fetched at ${entry.fetchedAt}.`,
    evidence: [`cacheStatus=${cacheStatus}`, `fetchedAt=${entry.fetchedAt}`, `expiresAt=${entry.expiresAt}`],
    sources: entry.sourceUrl === undefined ? [entry.key] : [entry.sourceUrl]
  };
}

export async function resolveWithCacheFallback(input: CacheFallbackInput): Promise<CacheFallbackResult> {
  try {
    const fresh = await input.fetchFresh();
    const sourceUrl = fresh.sourceUrl ?? input.sourceUrl;
    const entry = input.cache.set({
      key: input.key,
      sourceType: input.sourceType,
      ...(sourceUrl === undefined ? {} : { sourceUrl }),
      content: fresh.content,
      fetchedAt: input.now,
      expiresAt: expiresAt(input.now, input.ttlMs),
      status: fresh.status ?? "200"
    });

    return {
      ok: true,
      content: fresh.content,
      cacheStatus: "fresh",
      confidence: "high",
      warnings: [],
      entry
    };
  } catch (error) {
    const reason = errorReason(error);
    const cached = input.cache.get(input.key, input.sourceType, input.now);

    if (cached.cacheStatus === "miss") {
      return {
        ok: false,
        error: createNoEvidenceError({
          sourceUrl: input.sourceUrl,
          reason
        })
      };
    }

    return {
      ok: true,
      content: cached.entry.content,
      cacheStatus: cached.cacheStatus,
      confidence: cached.cacheStatus === "fresh" ? "medium" : "low",
      warnings: [cacheWarning(cached.cacheStatus, cached.entry, reason)],
      entry: cached.entry
    };
  }
}
