import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { SqliteCacheStore } from "../../../src/cache/sqlite-cache";
import { BUN_DOCS_INDEX_URL, BunDocsIndexAdapter } from "../../../src/sources/bun-docs-index";
import { SourceFetchClient, type FetchLike } from "../../../src/sources/fetch-client";
import {
  BUN_DOCS_INDEX_RESOURCE_URI,
  listBunDocsIndexResources,
  readBunDocsIndexResource
} from "../../../src/resources/bun-docs-index-resource";

const tempDirs: string[] = [];
const now = "2026-05-12T10:00:00.000Z";
const cachedIndex = `# Bun docs

- [TypeScript](https://bun.com/docs/runtime/typescript)
- [Lockfile](https://bun.com/docs/pm/lockfile)
`;

function createStore(): SqliteCacheStore {
  const dir = mkdtempSync(resolve(tmpdir(), "bun-dev-intel-index-resource-"));
  tempDirs.push(dir);
  return new SqliteCacheStore(resolve(dir, "cache.sqlite"));
}

function createAdapter(fetchImpl: FetchLike, store = createStore()): BunDocsIndexAdapter {
  return new BunDocsIndexAdapter({
    cache: store,
    fetchClient: new SourceFetchClient({
      fetchImpl,
      now: () => now
    }),
    now: () => now
  });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("bun-docs://index resource", () => {
  test("resource is listed", () => {
    expect(listBunDocsIndexResources()).toContainEqual({
      uri: BUN_DOCS_INDEX_RESOURCE_URI,
      name: "bun-docs-index",
      description: "Cached official Bun documentation index.",
      mimeType: "application/json"
    });
  });

  test("resource returns cached index", async () => {
    const store = createStore();
    store.set({
      key: BUN_DOCS_INDEX_URL,
      sourceType: "bun-docs",
      sourceUrl: BUN_DOCS_INDEX_URL,
      content: cachedIndex,
      fetchedAt: "2026-05-12T09:00:00.000Z",
      expiresAt: "2026-05-12T11:00:00.000Z",
      status: "200"
    });

    const result = await readBunDocsIndexResource({
      adapter: createAdapter(async () => {
        throw new Error("network unavailable");
      }, store)
    });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.uri).toBe("bun-docs://index");
      expect(result.pages.map((page) => page.url)).toEqual([
        "https://bun.com/docs/runtime/typescript",
        "https://bun.com/docs/pm/lockfile"
      ]);
      expect(result.cacheStatus).toBe("fresh");
      expect(result.sourceUrl).toBe(BUN_DOCS_INDEX_URL);
    }

    store.close();
  });

  test("resource includes cache metadata and citations", async () => {
    const result = await readBunDocsIndexResource({
      adapter: createAdapter(async () => new Response(cachedIndex, { status: 200 }))
    });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.fetchedAt).toBe(now);
      expect(result.cacheStatus).toBe("fresh");
      expect(result.sources).toEqual([
        {
          title: "Bun docs index",
          url: BUN_DOCS_INDEX_URL,
          sourceType: "bun-docs",
          fetchedAt: now
        }
      ]);
      expect(result.pages[0]).not.toHaveProperty("content");
    }
  });

  test("resource handles missing cache through source adapter policy", async () => {
    const result = await readBunDocsIndexResource({
      adapter: createAdapter(async () => new Response(cachedIndex, { status: 200 }))
    });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.pages).toHaveLength(2);
      expect(result.cacheStatus).toBe("fresh");
      expect(result.warnings).toEqual([]);
    }
  });
});
