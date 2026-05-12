import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { SqliteCacheStore } from "../../../src/cache/sqlite-cache";
import {
  BUN_DOCS_FULL_URL,
  BunDocsSearchAdapter,
  parseBunDocsContent
} from "../../../src/sources/bun-docs-search";
import { SourceFetchClient, type FetchLike } from "../../../src/sources/fetch-client";

const tempDirs: string[] = [];

const mockedFullDocs = `# TypeScript
URL: https://bun.com/docs/runtime/typescript
Bun supports TypeScript natively. Install @types/bun and set types to ["bun"] in tsconfig.json.
Use moduleResolution bundler, module Preserve, target ESNext, and noEmit true for editor type checking.

# Lockfile
URL: https://bun.com/docs/pm/lockfile
Bun uses a text bun.lock lockfile. Legacy bun.lockb files can be migrated to the current text lockfile format.

# Test Runner
URL: https://bun.com/docs/test
Use bun test to run tests. Test files can import test and expect from bun:test.

# Runtime
URL: https://bun.com/docs/runtime
Bun can execute TypeScript files directly in the runtime.
`;

function createStore(): SqliteCacheStore {
  const dir = mkdtempSync(resolve(tmpdir(), "bun-dev-intel-bun-search-"));
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

describe("Bun docs content search", () => {
  test("parses docs content into cited sections", () => {
    const sections = parseBunDocsContent(mockedFullDocs, "2026-05-12T10:00:00.000Z");

    expect(sections).toHaveLength(4);
    expect(sections[0]).toEqual({
      title: "TypeScript",
      url: "https://bun.com/docs/runtime/typescript",
      content: expect.stringContaining("@types/bun"),
      fetchedAt: "2026-05-12T10:00:00.000Z"
    });
  });

  test("finds TypeScript guidance for a TypeScript query", async () => {
    const adapter = createAdapter(async () => new Response(mockedFullDocs, { status: 200 }));

    const result = await adapter.search({ query: "TypeScript types bun", topic: "typescript" });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.results[0]?.title).toBe("TypeScript");
      expect(result.results[0]?.snippet).toContain("@types/bun");
      expect(result.sources[0]?.url).toBe("https://bun.com/docs/runtime/typescript");
    }
  });

  test("finds lockfile guidance for a lockfile query", async () => {
    const adapter = createAdapter(async () => new Response(mockedFullDocs, { status: 200 }));

    const result = await adapter.search({ query: "bun lockfile bun.lockb", topic: "package-manager" });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.results[0]?.title).toBe("Lockfile");
      expect(result.results[0]?.snippet).toContain("bun.lock");
    }
  });

  test("finds test runner guidance for a test query", async () => {
    const adapter = createAdapter(async () => new Response(mockedFullDocs, { status: 200 }));

    const result = await adapter.search({ query: "bun test bun:test", topic: "test-runner" });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.results[0]?.title).toBe("Test Runner");
      expect(result.results[0]?.snippet).toContain("bun:test");
    }
  });

  test("ranks title and heading matches above weak body matches", async () => {
    const adapter = createAdapter(async () => new Response(mockedFullDocs, { status: 200 }));

    const result = await adapter.search({ query: "TypeScript" });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.results[0]?.title).toBe("TypeScript");
      expect(result.results[0]?.relevanceScore).toBeGreaterThan(result.results[1]?.relevanceScore ?? 0);
    }
  });

  test("returns source citations and fetched timestamps", async () => {
    const adapter = createAdapter(async () => new Response(mockedFullDocs, { status: 200 }));

    const result = await adapter.search({ query: "moduleResolution bundler" });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.cacheStatus).toBe("fresh");
      expect(result.results[0]?.fetchedAt).toBe("2026-05-12T10:00:00.000Z");
      expect(result.sources[0]).toEqual({
        title: "TypeScript",
        url: "https://bun.com/docs/runtime/typescript",
        sourceType: "bun-docs",
        fetchedAt: "2026-05-12T10:00:00.000Z"
      });
    }
  });

  test("returns empty results with warning when no match exists", async () => {
    const adapter = createAdapter(async () => new Response(mockedFullDocs, { status: 200 }));

    const result = await adapter.search({ query: "nonexistent impossible query" });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.results).toEqual([]);
      expect(result.sources).toEqual([]);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]?.title).toContain("No Bun docs match");
    }
  });

  test("uses cached docs content when live fetch fails", async () => {
    const store = createStore();
    store.set({
      key: BUN_DOCS_FULL_URL,
      sourceType: "bun-docs",
      sourceUrl: BUN_DOCS_FULL_URL,
      content: mockedFullDocs,
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

    const result = await adapter.search({ query: "bun.lock" });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.cacheStatus).toBe("fresh");
      expect(result.results[0]?.title).toBe("Lockfile");
      expect(result.warnings).toHaveLength(1);
    }

    store.close();
  });
});
