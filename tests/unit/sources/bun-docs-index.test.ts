import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { SqliteCacheStore } from "../../../src/cache/sqlite-cache";
import {
  BUN_DOCS_INDEX_URL,
  BunDocsIndexAdapter,
  parseBunDocsIndex
} from "../../../src/sources/bun-docs-index";
import { SourceFetchClient, type FetchLike } from "../../../src/sources/fetch-client";

const tempDirs: string[] = [];

const mockedIndex = `# Bun Docs

- [Runtime](https://bun.com/docs/runtime)
- [TypeScript](https://bun.com/docs/runtime/typescript)
- [Install](https://bun.com/docs/pm/cli/install)
- [Workspaces](https://bun.com/docs/pm/workspaces)
- Test runner: https://bun.com/docs/test
`;

function createStore(): SqliteCacheStore {
  const dir = mkdtempSync(resolve(tmpdir(), "bun-dev-intel-bun-index-"));
  tempDirs.push(dir);
  return new SqliteCacheStore(resolve(dir, "cache.sqlite"));
}

function createAdapter(fetchImpl: FetchLike, store = createStore()): BunDocsIndexAdapter {
  return new BunDocsIndexAdapter({
    cache: store,
    fetchClient: new SourceFetchClient({
      fetchImpl,
      now: () => "2026-05-12T10:00:00.000Z"
    }),
    now: () => "2026-05-12T10:00:00.000Z"
  });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("Bun docs index", () => {
  test("parses a mocked llms.txt", () => {
    const pages = parseBunDocsIndex(mockedIndex, "2026-05-12T10:00:00.000Z");

    expect(pages).toEqual([
      {
        title: "Runtime",
        url: "https://bun.com/docs/runtime",
        topic: "runtime",
        sourceUrl: BUN_DOCS_INDEX_URL,
        fetchedAt: "2026-05-12T10:00:00.000Z"
      },
      {
        title: "TypeScript",
        url: "https://bun.com/docs/runtime/typescript",
        topic: "typescript",
        sourceUrl: BUN_DOCS_INDEX_URL,
        fetchedAt: "2026-05-12T10:00:00.000Z"
      },
      {
        title: "Install",
        url: "https://bun.com/docs/pm/cli/install",
        topic: "package-manager",
        sourceUrl: BUN_DOCS_INDEX_URL,
        fetchedAt: "2026-05-12T10:00:00.000Z"
      },
      {
        title: "Workspaces",
        url: "https://bun.com/docs/pm/workspaces",
        topic: "workspaces",
        sourceUrl: BUN_DOCS_INDEX_URL,
        fetchedAt: "2026-05-12T10:00:00.000Z"
      },
      {
        title: "Test runner",
        url: "https://bun.com/docs/test",
        topic: "test-runner",
        sourceUrl: BUN_DOCS_INDEX_URL,
        fetchedAt: "2026-05-12T10:00:00.000Z"
      }
    ]);
  });

  test("fetches index, extracts URLs, and stores cache metadata", async () => {
    const store = createStore();
    const adapter = createAdapter(async () => new Response(mockedIndex, { status: 200 }), store);

    const result = await adapter.listPages();

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.cacheStatus).toBe("fresh");
      expect(result.sourceUrl).toBe(BUN_DOCS_INDEX_URL);
      expect(result.fetchedAt).toBe("2026-05-12T10:00:00.000Z");
      expect(result.pages.map((page) => page.url)).toContain("https://bun.com/docs/runtime/typescript");
    }

    const cached = store.get(BUN_DOCS_INDEX_URL, "bun-docs", "2026-05-12T10:00:01.000Z");
    expect(cached.cacheStatus).toBe("fresh");
    store.close();
  });

  test("lists pages by topic", async () => {
    const adapter = createAdapter(async () => new Response(mockedIndex, { status: 200 }));

    const result = await adapter.listPages("typescript");

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.pages).toHaveLength(1);
      expect(result.pages[0]?.title).toBe("TypeScript");
    }
  });

  test("falls back to cached index on fetch failure", async () => {
    const store = createStore();
    store.set({
      key: BUN_DOCS_INDEX_URL,
      sourceType: "bun-docs",
      sourceUrl: BUN_DOCS_INDEX_URL,
      content: mockedIndex,
      fetchedAt: "2026-05-12T09:00:00.000Z",
      expiresAt: "2026-05-12T11:00:00.000Z",
      status: "200"
    });
    const adapter = createAdapter(
      async () => {
        throw new Error("network unavailable");
      },
      store
    );

    const result = await adapter.listPages();

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.cacheStatus).toBe("fresh");
      expect(result.warnings).toHaveLength(1);
      expect(result.pages).toHaveLength(5);
    }

    store.close();
  });

  test("returns no fabricated pages when no evidence exists", async () => {
    const adapter = createAdapter(async () => {
      throw new Error("network unavailable");
    });

    const result = await adapter.listPages();

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe("no_evidence");
    }
  });
});
