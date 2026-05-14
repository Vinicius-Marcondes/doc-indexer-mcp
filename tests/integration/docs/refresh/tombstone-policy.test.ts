import { describe, expect, test } from "bun:test";
import { createStructuredError, type StructuredError } from "../../../../src/shared/errors";
import {
  recordTombstoneRefreshFailure,
  type DocsTombstonePolicyStore
} from "../../../../src/docs/refresh/tombstone-policy";
import { searchDocs } from "../../../../src/tools/search-docs";
import { getDocPage } from "../../../../src/tools/get-doc-page";
import type { DocsRetrievalInput, DocsRetrievalResult } from "../../../../src/docs/retrieval/hybrid-retrieval";
import { defaultDocsSourceRegistry } from "../../../../src/docs/sources/bun-source-pack";
import type { StoredDocsChunk, StoredDocsPage } from "../../../../src/resources/docs-resources";

const now = "2026-05-14T12:00:00.000Z";
const url = "https://bun.com/docs/runtime/http-server";

function sourceRemovalError(status: 404 | 410): StructuredError {
  return createStructuredError("fetch_failed", "Source fetch failed with a non-success HTTP status.", {
    sourceUrl: url,
    status,
    statusText: status === 404 ? "Not Found" : "Gone"
  });
}

function page(overrides: Partial<StoredDocsPage> = {}): StoredDocsPage {
  return {
    id: 10,
    sourceId: "bun",
    url,
    canonicalUrl: url,
    title: "HTTP server",
    content: "# HTTP server\n\nUse Bun.serve.",
    contentHash: "page-hash",
    fetchedAt: "2026-05-01T12:00:00.000Z",
    indexedAt: "2026-05-01T12:00:00.000Z",
    expiresAt: "2026-05-08T12:00:00.000Z",
    tombstonedAt: null,
    tombstoneReason: null,
    ...overrides
  };
}

function chunk(overrides: Partial<StoredDocsChunk> = {}): StoredDocsChunk {
  return {
    id: 100,
    sourceId: "bun",
    pageId: 10,
    url,
    title: "HTTP server",
    headingPath: ["Runtime", "HTTP server"],
    chunkIndex: 0,
    content: "Use Bun.serve.",
    contentHash: "chunk-hash",
    tokenEstimate: 3,
    previousChunkId: null,
    nextChunkId: null,
    ...overrides
  };
}

class InMemoryTombstoneStore implements DocsTombstonePolicyStore {
  failures = 0;
  storedPage: StoredDocsPage | null = page();

  async recordConfirmedRemovalFailure(_input: {
    sourceId: string;
    url: string;
    status: 404 | 410;
    error: StructuredError;
    now: string;
  }): Promise<number> {
    this.failures += 1;
    return this.failures;
  }

  async markPageTombstoned(input: {
    sourceId: string;
    url: string;
    reason: string;
    now: string;
  }): Promise<StoredDocsPage | null> {
    if (this.storedPage === null || this.storedPage.sourceId !== input.sourceId || this.storedPage.canonicalUrl !== input.url) {
      return null;
    }

    this.storedPage = {
      ...this.storedPage,
      tombstonedAt: input.now,
      tombstoneReason: input.reason
    };
    return this.storedPage;
  }
}

class FakePageStore {
  constructor(private readonly store: InMemoryTombstoneStore) {}

  async listSourceStats() {
    return [];
  }

  async getPageByUrl(input: { sourceId: string; url: string }): Promise<StoredDocsPage | null> {
    const storedPage = this.store.storedPage;

    if (storedPage?.sourceId === input.sourceId && storedPage.canonicalUrl === input.url) {
      return storedPage;
    }

    return null;
  }

  async getChunksForPage(_pageId: number): Promise<StoredDocsChunk[]> {
    return this.store.storedPage?.tombstonedAt === null ? [chunk()] : [];
  }

  async getPageById(_input: { sourceId: string; pageId: number }): Promise<StoredDocsPage | null> {
    return this.store.storedPage;
  }

  async getChunkById(_input: { sourceId: string; chunkId: number }): Promise<StoredDocsChunk | null> {
    return this.store.storedPage?.tombstonedAt === null ? chunk() : null;
  }
}

class TombstoneAwareRetrieval {
  constructor(private readonly store: InMemoryTombstoneStore) {}

  async search(input: DocsRetrievalInput): Promise<DocsRetrievalResult> {
    const includeResult = this.store.storedPage?.tombstonedAt === null;

    return {
      query: input.query,
      sourceId: input.sourceId,
      mode: input.mode ?? "hybrid",
      limit: input.limit ?? 5,
      results: includeResult
        ? [
            {
              chunkId: 100,
              pageId: 10,
              title: "HTTP server",
              url,
              headingPath: ["Runtime", "HTTP server"],
              snippet: "Use Bun.serve.",
              score: 3,
              keywordScore: 3,
              vectorScore: 0,
              rerankScore: 0,
              fetchedAt: "2026-05-01T12:00:00.000Z",
              indexedAt: "2026-05-01T12:00:00.000Z",
              contentHash: "chunk-hash"
            }
          ]
        : [],
      freshness: includeResult ? "stale" : "missing",
      confidence: includeResult ? "medium" : "low",
      lowConfidence: !includeResult,
      refreshQueued: false,
      ...(includeResult ? { refreshReason: "stale_content" as const } : { refreshReason: "missing_content" as const }),
      retrieval: {
        mode: input.mode ?? "hybrid",
        keywordAttempted: true,
        vectorAttempted: true,
        keywordResultCount: includeResult ? 1 : 0,
        vectorResultCount: 0,
        mergedResultCount: includeResult ? 1 : 0,
        queryHash: "hash"
      },
      warnings: includeResult ? [{ code: "stale_results", message: "One or more retrieved documentation chunks are stale." }] : []
    };
  }
}

describe("docs tombstone policy", () => {
  test("first 404 records failure but does not tombstone when confirmation is required", async () => {
    const store = new InMemoryTombstoneStore();
    const result = await recordTombstoneRefreshFailure({
      sourceId: "bun",
      url,
      error: sourceRemovalError(404),
      store,
      now,
      confirmationThreshold: 2
    });

    expect(result.status).toBe("recorded");
    expect(result.confirmedFailures).toBe(1);
    expect(result.tombstoned).toBe(false);
    expect(store.storedPage?.tombstonedAt).toBe(null);
  });

  test("repeated 404 or 410 tombstones page", async () => {
    const store = new InMemoryTombstoneStore();
    await recordTombstoneRefreshFailure({
      sourceId: "bun",
      url,
      error: sourceRemovalError(404),
      store,
      now,
      confirmationThreshold: 2
    });
    const result = await recordTombstoneRefreshFailure({
      sourceId: "bun",
      url,
      error: sourceRemovalError(410),
      store,
      now,
      confirmationThreshold: 2
    });

    expect(result.status).toBe("tombstoned");
    expect(result.confirmedFailures).toBe(2);
    expect(store.storedPage?.tombstonedAt).toBe(now);
    expect(store.storedPage?.tombstoneReason).toContain("confirmed source removal");
  });

  test("tombstoned page is excluded from search", async () => {
    const store = new InMemoryTombstoneStore();
    store.storedPage = page({ tombstonedAt: now, tombstoneReason: "confirmed source removal after 2 failed fetches" });
    const result = await searchDocs(
      { query: "Bun.serve" },
      {
        retrieval: new TombstoneAwareRetrieval(store),
        sourceRegistry: defaultDocsSourceRegistry,
        now: () => now,
        defaultLimit: 5,
        maxLimit: 20
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected search success.");
    }
    expect(result.results).toEqual([]);
    expect(result.freshness).toBe("missing");
  });

  test("direct page lookup returns tombstone response", async () => {
    const store = new InMemoryTombstoneStore();
    store.storedPage = page({ tombstonedAt: now, tombstoneReason: "confirmed source removal after 2 failed fetches" });

    const result = await getDocPage(
      { url },
      {
        pageStore: new FakePageStore(store),
        sourceRegistry: defaultDocsSourceRegistry,
        now: () => now
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected page response.");
    }
    expect(result.freshness).toBe("missing");
    expect(result.tombstonedAt).toBe(now);
    expect(result.tombstoneReason).toContain("confirmed source removal");
    expect(result.content).toBe(null);
    expect(result.chunks).toEqual([]);
    expect(result.warnings.map((warning) => warning.code)).toContain("tombstoned_page");
  });

  test("low-confidence search does not tombstone anything", async () => {
    const store = new InMemoryTombstoneStore();
    const result = await recordTombstoneRefreshFailure({
      sourceId: "bun",
      url,
      error: createStructuredError("no_evidence", "Low-confidence search has no source removal evidence."),
      store,
      now,
      confirmationThreshold: 2
    });

    expect(result.status).toBe("ignored");
    expect(store.failures).toBe(0);
    expect(store.storedPage?.tombstonedAt).toBe(null);
  });
});
