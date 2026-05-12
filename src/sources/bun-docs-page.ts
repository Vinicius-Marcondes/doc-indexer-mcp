import { resolveWithCacheFallback } from "../cache/fallback-policy";
import type { SqliteCacheStore } from "../cache/sqlite-cache";
import type { CacheStatus, Confidence, ResponseWarning } from "../shared/contracts";
import { createNoEvidenceError, createStructuredError, type StructuredError } from "../shared/errors";
import { BUN_DOCS_INDEX_URL, type BunDocsIndexAdapter, type BunDocsIndexPage } from "./bun-docs-index";
import type { SourceFetchClient } from "./fetch-client";

const DEFAULT_BUN_DOCS_PAGE_TTL_MS = 24 * 60 * 60 * 1000;
const slugPattern = /^[a-z0-9][a-z0-9/-]*$/u;

export interface BunDocsPageSuccess {
  readonly ok: true;
  readonly slug: string;
  readonly title: string;
  readonly url: string;
  readonly content: string;
  readonly fetchedAt: string;
  readonly contentHash: string;
  readonly cacheStatus: Extract<CacheStatus, "fresh" | "stale">;
  readonly confidence: Confidence;
  readonly warnings: ResponseWarning[];
}

export interface BunDocsPageFailure {
  readonly ok: false;
  readonly error: StructuredError;
}

export type BunDocsPageResult = BunDocsPageSuccess | BunDocsPageFailure;

export interface BunDocsPageAdapterOptions {
  readonly cache: SqliteCacheStore;
  readonly fetchClient: SourceFetchClient;
  readonly indexAdapter: BunDocsIndexAdapter;
  readonly now?: () => string;
  readonly ttlMs?: number;
}

export function isValidBunDocsPageSlug(slug: string): boolean {
  return (
    slugPattern.test(slug) &&
    !slug.includes("//") &&
    !slug.endsWith("/") &&
    !slug.split("/").some((part) => part.length === 0)
  );
}

function invalidSlugError(slug: string): StructuredError {
  return createStructuredError("invalid_input", "Invalid Bun docs page slug.", {
    slug,
    expected: "Lowercase Bun docs path segments such as runtime/typescript"
  });
}

function slugFromPageUrl(url: string): string | null {
  try {
    const parsed = new URL(url);

    if (parsed.hostname !== "bun.com" || !parsed.pathname.startsWith("/docs/")) {
      return null;
    }

    const slug = decodeURIComponent(parsed.pathname.slice("/docs/".length));
    return isValidBunDocsPageSlug(slug) ? slug : null;
  } catch {
    return null;
  }
}

function resolvePage(slug: string, pages: readonly BunDocsIndexPage[]): BunDocsIndexPage | null {
  return pages.find((page) => slugFromPageUrl(page.url) === slug) ?? null;
}

function mergeConfidence(left: Confidence, right: Confidence): Confidence {
  if (left === "low" || right === "low") {
    return "low";
  }

  if (left === "medium" || right === "medium") {
    return "medium";
  }

  return "high";
}

export class BunDocsPageAdapter {
  private readonly cache: SqliteCacheStore;
  private readonly fetchClient: SourceFetchClient;
  private readonly indexAdapter: BunDocsIndexAdapter;
  private readonly now: () => string;
  private readonly ttlMs: number;

  constructor(options: BunDocsPageAdapterOptions) {
    this.cache = options.cache;
    this.fetchClient = options.fetchClient;
    this.indexAdapter = options.indexAdapter;
    this.now = options.now ?? (() => new Date().toISOString());
    this.ttlMs = options.ttlMs ?? DEFAULT_BUN_DOCS_PAGE_TTL_MS;
  }

  async getPage(slug: string): Promise<BunDocsPageResult> {
    if (!isValidBunDocsPageSlug(slug)) {
      return {
        ok: false,
        error: invalidSlugError(slug)
      };
    }

    const index = await this.indexAdapter.listPages();

    if (!index.ok) {
      return index;
    }

    const page = resolvePage(slug, index.pages);

    if (page === null) {
      return {
        ok: false,
        error: createNoEvidenceError({
          sourceUrl: BUN_DOCS_INDEX_URL,
          reason: `Slug "${slug}" was not found in the official Bun docs index.`
        })
      };
    }

    const resolved = await resolveWithCacheFallback({
      cache: this.cache,
      key: page.url,
      sourceType: "bun-docs",
      sourceUrl: page.url,
      now: this.now(),
      ttlMs: this.ttlMs,
      fetchFresh: async () => {
        const fetched = await this.fetchClient.fetchText(page.url);

        if (!fetched.ok) {
          throw new Error(fetched.error.message);
        }

        return {
          content: fetched.body,
          status: String(fetched.status),
          sourceUrl: fetched.finalUrl
        };
      }
    });

    if (!resolved.ok) {
      return resolved;
    }

    return {
      ok: true,
      slug,
      title: page.title,
      url: page.url,
      content: resolved.content,
      fetchedAt: resolved.entry.fetchedAt,
      contentHash: resolved.entry.contentHash,
      cacheStatus: resolved.cacheStatus,
      confidence: mergeConfidence(index.confidence, resolved.confidence),
      warnings: [...index.warnings, ...resolved.warnings]
    };
  }
}
