import { describe, expect, test } from "bun:test";
import { getDocPage } from "../../../src/tools/get-doc-page";
import { defaultDocsSourceRegistry } from "../../../src/docs/sources/bun-source-pack";
import type { StoredDocsChunk, StoredDocsPage } from "../../../src/resources/docs-resources";

const now = "2026-05-14T12:00:00.000Z";

function page(overrides: Partial<StoredDocsPage> = {}): StoredDocsPage {
  return {
    id: 10,
    sourceId: "bun",
    url: "https://bun.com/docs/runtime/http-server",
    canonicalUrl: "https://bun.com/docs/runtime/http-server",
    title: "HTTP server",
    content: "# HTTP server\n\nUse Bun.serve to start a server.",
    contentHash: "page-hash",
    fetchedAt: "2026-05-14T10:00:00.000Z",
    indexedAt: "2026-05-14T10:05:00.000Z",
    expiresAt: "2026-05-21T10:00:00.000Z",
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
    url: "https://bun.com/docs/runtime/http-server",
    title: "HTTP server",
    headingPath: ["Runtime", "HTTP server"],
    chunkIndex: 0,
    content: "Use Bun.serve to start a server.",
    contentHash: "chunk-hash",
    tokenEstimate: 8,
    previousChunkId: null,
    nextChunkId: null,
    ...overrides
  };
}

class FakePageStore {
  pageByUrl: StoredDocsPage | null = page();
  chunks: StoredDocsChunk[] = [chunk()];
  pageLookups = 0;

  async listSourceStats() {
    return [];
  }

  async getPageByUrl(input: { sourceId: string; url: string }): Promise<StoredDocsPage | null> {
    this.pageLookups += 1;
    if (this.pageByUrl?.sourceId === input.sourceId && this.pageByUrl.canonicalUrl === input.url) {
      return this.pageByUrl;
    }
    return null;
  }

  async getChunksForPage(_pageId: number): Promise<StoredDocsChunk[]> {
    return this.chunks;
  }

  async getPageById(_input: { sourceId: string; pageId: number }): Promise<StoredDocsPage | null> {
    return this.pageByUrl;
  }

  async getChunkById(_input: { sourceId: string; chunkId: number }): Promise<StoredDocsChunk | null> {
    return this.chunks[0] ?? null;
  }
}

function dependencies(store: FakePageStore) {
  return {
    pageStore: store,
    sourceRegistry: defaultDocsSourceRegistry,
    now: () => now
  };
}

describe("get_doc_page tool", () => {
  test("stored page can be retrieved by allowed URL", async () => {
    const result = await getDocPage(
      { url: "https://bun.com/docs/runtime/http-server" },
      dependencies(new FakePageStore())
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected stored page success.");
    }
    expect(result).toMatchObject({
      sourceId: "bun",
      url: "https://bun.com/docs/runtime/http-server",
      title: "HTTP server",
      content: "# HTTP server\n\nUse Bun.serve to start a server.",
      contentHash: "page-hash",
      freshness: "fresh",
      refreshQueued: false
    });
    expect(result.chunks).toHaveLength(1);
    expect(result.sources[0]).toMatchObject({
      title: "HTTP server",
      url: "https://bun.com/docs/runtime/http-server",
      sourceType: "bun-docs",
      contentHash: "page-hash"
    });
  });

  test("disallowed URL returns structured error", async () => {
    const store = new FakePageStore();
    const result = await getDocPage({ url: "https://example.com/docs/runtime" }, dependencies(store));

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected disallowed URL failure.");
    }
    expect(result.error.code).toBe("disallowed_source");
    expect(store.pageLookups).toBe(0);
  });

  test("missing allowed URL returns explicit missing fetch signal", async () => {
    const store = new FakePageStore();
    store.pageByUrl = null;
    const result = await getDocPage({ url: "https://bun.com/docs/runtime/http-server" }, dependencies(store));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected missing page response.");
    }
    expect(result).toMatchObject({
      sourceId: "bun",
      url: "https://bun.com/docs/runtime/http-server",
      title: null,
      content: null,
      chunks: [],
      freshness: "missing",
      refreshQueued: false,
      refreshReason: "missing_content"
    });
    expect(result.warnings.map((warning) => warning.code)).toContain("missing_page");
  });

  test("stale page returns stale freshness", async () => {
    const store = new FakePageStore();
    store.pageByUrl = page({ expiresAt: "2026-05-01T00:00:00.000Z" });

    const result = await getDocPage({ url: "https://bun.com/docs/runtime/http-server" }, dependencies(store));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected stale page response.");
    }
    expect(result.freshness).toBe("stale");
    expect(result.refreshReason).toBe("stale_content");
    expect(result.warnings.map((warning) => warning.code)).toContain("stale_page");
  });
});
