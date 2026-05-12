import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { SqliteCacheStore } from "../../../src/cache/sqlite-cache";
import { BUN_DOCS_FULL_URL, BunDocsSearchAdapter } from "../../../src/sources/bun-docs-search";
import { SourceFetchClient, type FetchLike } from "../../../src/sources/fetch-client";
import { searchBunDocs } from "../../../src/tools/search-bun-docs";

const tempDirs: string[] = [];

const mockedDocs = `# TypeScript
URL: https://bun.com/docs/runtime/typescript
Install @types/bun and set types to ["bun"] for Bun TypeScript projects.

# Lockfile
URL: https://bun.com/docs/pm/lockfile
Bun uses bun.lock. Legacy bun.lockb should be migrated.
`;

function createStore(): SqliteCacheStore {
  const dir = mkdtempSync(resolve(tmpdir(), "bun-dev-intel-search-tool-"));
  tempDirs.push(dir);
  return new SqliteCacheStore(resolve(dir, "cache.sqlite"));
}

function createAdapter(fetchImpl: FetchLike, store = createStore()): BunDocsSearchAdapter {
  return new BunDocsSearchAdapter({
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

describe("search_bun_docs tool", () => {
  test("TypeScript query returns TypeScript docs result from mocked docs", async () => {
    const result = await searchBunDocs(
      { query: "typescript types bun", topic: "typescript" },
      { adapter: createAdapter(async () => new Response(mockedDocs, { status: 200 })) }
    );

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.results[0]?.title).toBe("TypeScript");
      expect(result.sources[0]?.url).toBe("https://bun.com/docs/runtime/typescript");
      expect(result.cacheStatus).toBe("fresh");
    }
  });

  test("lockfile query returns lockfile docs result from mocked docs", async () => {
    const result = await searchBunDocs(
      { query: "bun.lockb lockfile", topic: "package-manager" },
      { adapter: createAdapter(async () => new Response(mockedDocs, { status: 200 })) }
    );

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.results[0]?.title).toBe("Lockfile");
    }
  });

  test("invalid topic fails validation", async () => {
    const result = await searchBunDocs(
      { query: "typescript", topic: "invalid-topic" },
      { adapter: createAdapter(async () => new Response(mockedDocs, { status: 200 })) }
    );

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe("invalid_input");
    }
  });

  test("network failure plus stale cache returns stale result with warning", async () => {
    const store = createStore();
    store.set({
      key: BUN_DOCS_FULL_URL,
      sourceType: "bun-docs",
      sourceUrl: BUN_DOCS_FULL_URL,
      content: mockedDocs,
      fetchedAt: "2026-05-12T08:00:00.000Z",
      expiresAt: "2026-05-12T09:00:00.000Z",
      status: "200"
    });

    const result = await searchBunDocs(
      { query: "bun.lock" },
      {
        adapter: createAdapter(
          async () => {
            throw new Error("network unavailable");
          },
          store
        )
      }
    );

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.cacheStatus).toBe("stale");
      expect(result.warnings).toHaveLength(1);
      expect(result.results[0]?.title).toBe("Lockfile");
    }

    store.close();
  });

  test("no cache plus fetch failure returns structured error", async () => {
    const result = await searchBunDocs(
      { query: "typescript" },
      {
        adapter: createAdapter(async () => {
          throw new Error("network unavailable");
        })
      }
    );

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe("no_evidence");
    }
  });
});
