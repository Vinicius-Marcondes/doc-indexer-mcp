import { describe, expect, test } from "bun:test";
import {
  readDocsChunkResource,
  readDocsPageResource,
  readDocsSourcesResource,
  type StoredDocsChunk,
  type StoredDocsPage,
  type StoredDocsSourceStats
} from "../../../src/resources/docs-resources";
import { defaultDocsSourceRegistry } from "../../../src/docs/sources/bun-source-pack";

const now = "2026-05-14T12:00:00.000Z";

const storedPage: StoredDocsPage = {
  id: 10,
  sourceId: "bun",
  url: "https://bun.com/docs/runtime/http-server",
  canonicalUrl: "https://bun.com/docs/runtime/http-server",
  title: "HTTP server",
  content: "# HTTP server\n\nUse Bun.serve.",
  contentHash: "page-hash",
  fetchedAt: "2026-05-14T10:00:00.000Z",
  indexedAt: "2026-05-14T10:05:00.000Z",
  expiresAt: "2026-05-21T10:00:00.000Z",
  tombstonedAt: null,
  tombstoneReason: null
};

const storedChunk: StoredDocsChunk = {
  id: 100,
  sourceId: "bun",
  pageId: 10,
  url: "https://bun.com/docs/runtime/http-server",
  title: "HTTP server",
  headingPath: ["Runtime", "HTTP server"],
  chunkIndex: 0,
  content: "Use Bun.serve.",
  contentHash: "chunk-hash",
  tokenEstimate: 5,
  previousChunkId: null,
  nextChunkId: 101
};

class FakeDocsResourceStore {
  pageLookups = 0;
  chunkLookups = 0;

  async listSourceStats(): Promise<StoredDocsSourceStats[]> {
    return [
      {
        sourceId: "bun",
        displayName: "Bun Documentation",
        enabled: true,
        allowedUrlPatterns: ["https://bun.com/docs/*"],
        defaultTtlSeconds: 604800,
        pageCount: 1,
        chunkCount: 2
      }
    ];
  }

  async getPageById(input: { sourceId: string; pageId: number }): Promise<StoredDocsPage | null> {
    this.pageLookups += 1;
    return input.sourceId === "bun" && input.pageId === storedPage.id ? storedPage : null;
  }

  async getPageByUrl(input: { sourceId: string; url: string }): Promise<StoredDocsPage | null> {
    this.pageLookups += 1;
    return input.sourceId === "bun" && input.url === storedPage.canonicalUrl ? storedPage : null;
  }

  async getChunksForPage(pageId: number): Promise<StoredDocsChunk[]> {
    return pageId === storedPage.id ? [storedChunk] : [];
  }

  async getChunkById(input: { sourceId: string; chunkId: number }): Promise<StoredDocsChunk | null> {
    this.chunkLookups += 1;
    return input.sourceId === "bun" && input.chunkId === storedChunk.id ? storedChunk : null;
  }
}

function dependencies(store: FakeDocsResourceStore) {
  return {
    pageStore: store,
    sourceRegistry: defaultDocsSourceRegistry,
    now: () => now
  };
}

describe("docs resources", () => {
  test("docs://sources lists Bun source", async () => {
    const result = await readDocsSourcesResource(dependencies(new FakeDocsResourceStore()));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected sources resource success.");
    }
    expect(result.sources).toEqual([
      {
        sourceId: "bun",
        displayName: "Bun Documentation",
        enabled: true,
        allowedHosts: ["bun.com"],
        pageCount: 1,
        chunkCount: 2
      }
    ]);
  });

  test("page resource returns stored page", async () => {
    const result = await readDocsPageResource({ sourceId: "bun", pageId: "10" }, dependencies(new FakeDocsResourceStore()));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected page resource success.");
    }
    expect(result).toMatchObject({
      sourceId: "bun",
      pageId: 10,
      title: "HTTP server",
      url: "https://bun.com/docs/runtime/http-server",
      contentHash: "page-hash",
      freshness: "fresh"
    });
    expect(result.chunks[0]).toMatchObject({
      chunkId: 100,
      headingPath: ["Runtime", "HTTP server"]
    });
  });

  test("chunk resource returns stored chunk", async () => {
    const result = await readDocsChunkResource({ sourceId: "bun", chunkId: "100" }, dependencies(new FakeDocsResourceStore()));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected chunk resource success.");
    }
    expect(result).toMatchObject({
      sourceId: "bun",
      chunkId: 100,
      pageId: 10,
      title: "HTTP server",
      content: "Use Bun.serve.",
      previousChunkId: null,
      nextChunkId: 101
    });
  });

  test("invalid source/page/chunk returns structured error", async () => {
    const store = new FakeDocsResourceStore();
    const invalidSource = await readDocsPageResource({ sourceId: "other", pageId: "10" }, dependencies(store));
    const invalidPageId = await readDocsPageResource({ sourceId: "bun", pageId: "not-a-number" }, dependencies(store));
    const missingChunk = await readDocsChunkResource({ sourceId: "bun", chunkId: "999" }, dependencies(store));

    expect(invalidSource.ok).toBe(false);
    if (!invalidSource.ok) {
      expect(invalidSource.error.code).toBe("disallowed_source");
    }
    expect(invalidPageId.ok).toBe(false);
    if (!invalidPageId.ok) {
      expect(invalidPageId.error.code).toBe("invalid_input");
    }
    expect(missingChunk.ok).toBe(false);
    if (!missingChunk.ok) {
      expect(missingChunk.error.code).toBe("no_evidence");
    }
  });

  test("resource template manipulation cannot fetch arbitrary URL", async () => {
    const store = new FakeDocsResourceStore();
    const result = await readDocsPageResource(
      { sourceId: "https:%2f%2fevil.example", pageId: "10" },
      dependencies(store)
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected manipulated source failure.");
    }
    expect(result.error.code).toBe("disallowed_source");
    expect(store.pageLookups).toBe(0);
  });
});
