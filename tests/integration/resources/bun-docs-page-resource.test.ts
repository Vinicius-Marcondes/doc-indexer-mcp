import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { computeContentHash, SqliteCacheStore } from "../../../src/cache/sqlite-cache";
import { BUN_DOCS_INDEX_URL, BunDocsIndexAdapter } from "../../../src/sources/bun-docs-index";
import { BunDocsPageAdapter } from "../../../src/sources/bun-docs-page";
import { SourceFetchClient, type FetchLike } from "../../../src/sources/fetch-client";
import {
  BUN_DOCS_PAGE_RESOURCE_URI_TEMPLATE,
  readBunDocsPageResource
} from "../../../src/resources/bun-docs-page-resource";

const tempDirs: string[] = [];
const now = "2026-05-12T10:00:00.000Z";
const indexContent = `# Bun docs

- [TypeScript](https://bun.com/docs/runtime/typescript)
- [Lockfile](https://bun.com/docs/pm/lockfile)
`;
const pageContent = "# TypeScript\n\nInstall @types/bun and set compilerOptions.types to [\"bun\"].\n";

function createStore(): SqliteCacheStore {
  const dir = mkdtempSync(resolve(tmpdir(), "bun-dev-intel-page-resource-"));
  tempDirs.push(dir);
  return new SqliteCacheStore(resolve(dir, "cache.sqlite"));
}

function createPageAdapter(fetchImpl: FetchLike, store = createStore()): BunDocsPageAdapter {
  const fetchClient = new SourceFetchClient({
    fetchImpl,
    now: () => now
  });
  const indexAdapter = new BunDocsIndexAdapter({
    cache: store,
    fetchClient,
    now: () => now
  });

  return new BunDocsPageAdapter({
    cache: store,
    fetchClient,
    indexAdapter,
    now: () => now
  });
}

function createFetch(): FetchLike {
  return async (url) => {
    const href = String(url);

    if (href === BUN_DOCS_INDEX_URL) {
      return new Response(indexContent, { status: 200 });
    }

    if (href === "https://bun.com/docs/runtime/typescript") {
      return new Response(pageContent, { status: 200 });
    }

    throw new Error(`unexpected fetch: ${href}`);
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("bun-docs://page/{slug} resource", () => {
  test("valid slug returns page content", async () => {
    const result = await readBunDocsPageResource(
      { slug: "runtime/typescript" },
      { adapter: createPageAdapter(createFetch()) }
    );

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.uri).toBe("bun-docs://page/runtime/typescript");
      expect(result.uriTemplate).toBe(BUN_DOCS_PAGE_RESOURCE_URI_TEMPLATE);
      expect(result.slug).toBe("runtime/typescript");
      expect(result.title).toBe("TypeScript");
      expect(result.url).toBe("https://bun.com/docs/runtime/typescript");
      expect(result.content).toContain("@types/bun");
      expect(result.contentHash).toBe(computeContentHash(pageContent));
      expect(result.cacheStatus).toBe("fresh");
    }
  });

  test("invalid slug returns structured error without fetching", async () => {
    let fetchCount = 0;
    const result = await readBunDocsPageResource(
      { slug: "runtime/../typescript" },
      {
        adapter: createPageAdapter(async () => {
          fetchCount += 1;
          return new Response("", { status: 200 });
        })
      }
    );

    expect(result.ok).toBe(false);
    expect(fetchCount).toBe(0);

    if (!result.ok) {
      expect(result.error.code).toBe("invalid_input");
    }
  });

  test("page includes source metadata", async () => {
    const result = await readBunDocsPageResource(
      { slug: "runtime/typescript" },
      { adapter: createPageAdapter(createFetch()) }
    );

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.fetchedAt).toBe(now);
      expect(result.sources).toEqual([
        {
          title: "TypeScript",
          url: "https://bun.com/docs/runtime/typescript",
          sourceType: "bun-docs",
          fetchedAt: now,
          contentHash: computeContentHash(pageContent)
        }
      ]);
    }
  });

  test("unknown slugs do not fetch arbitrary pages", async () => {
    const fetchedUrls: string[] = [];
    const result = await readBunDocsPageResource(
      { slug: "runtime/not-listed" },
      {
        adapter: createPageAdapter(async (url) => {
          fetchedUrls.push(String(url));
          return new Response(indexContent, { status: 200 });
        })
      }
    );

    expect(result.ok).toBe(false);
    expect(fetchedUrls).toEqual([BUN_DOCS_INDEX_URL]);

    if (!result.ok) {
      expect(result.error.code).toBe("no_evidence");
    }
  });

  test("disallowed URL cannot be reached through slug manipulation", async () => {
    let fetchCount = 0;
    const result = await readBunDocsPageResource(
      { slug: "https://example.com/docs/runtime/typescript" },
      {
        adapter: createPageAdapter(async () => {
          fetchCount += 1;
          return new Response("", { status: 200 });
        })
      }
    );

    expect(result.ok).toBe(false);
    expect(fetchCount).toBe(0);

    if (!result.ok) {
      expect(result.error.code).toBe("invalid_input");
    }
  });
});
