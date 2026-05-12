import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { resolveWithCacheFallback } from "../../../src/cache/fallback-policy";
import { SqliteCacheStore } from "../../../src/cache/sqlite-cache";

const tempDirs: string[] = [];

function createStore(): SqliteCacheStore {
  const dir = mkdtempSync(resolve(tmpdir(), "bun-dev-intel-fallback-"));
  tempDirs.push(dir);
  return new SqliteCacheStore(resolve(dir, "cache.sqlite"));
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("cache fallback policy", () => {
  test("live fetch success stores fresh cache", async () => {
    const store = createStore();

    const result = await resolveWithCacheFallback({
      cache: store,
      key: "https://bun.com/docs/llms.txt",
      sourceType: "bun-docs",
      sourceUrl: "https://bun.com/docs/llms.txt",
      now: "2026-05-12T10:00:00.000Z",
      ttlMs: 60_000,
      fetchFresh: async () => ({ content: "fresh docs", status: "200" })
    });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.cacheStatus).toBe("fresh");
      expect(result.content).toBe("fresh docs");
      expect(result.confidence).toBe("high");
      expect(result.warnings).toEqual([]);
    }

    expect(store.get("https://bun.com/docs/llms.txt", "bun-docs", "2026-05-12T10:00:01.000Z").cacheStatus).toBe(
      "fresh"
    );

    store.close();
  });

  test("live fetch failure plus fresh cache returns fresh cache with warning", async () => {
    const store = createStore();
    store.set({
      key: "bun-docs",
      sourceType: "bun-docs",
      content: "cached docs",
      fetchedAt: "2026-05-12T09:59:00.000Z",
      expiresAt: "2026-05-12T11:00:00.000Z",
      status: "200"
    });

    const result = await resolveWithCacheFallback({
      cache: store,
      key: "bun-docs",
      sourceType: "bun-docs",
      now: "2026-05-12T10:00:00.000Z",
      ttlMs: 60_000,
      fetchFresh: async () => {
        throw new Error("network unavailable");
      }
    });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.cacheStatus).toBe("fresh");
      expect(result.content).toBe("cached docs");
      expect(result.confidence).toBe("medium");
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]?.detail).toContain("network unavailable");
    }

    store.close();
  });

  test("live fetch failure plus stale cache returns stale cache and lower confidence", async () => {
    const store = createStore();
    store.set({
      key: "typescript",
      sourceType: "typescript-docs",
      content: "stale docs",
      fetchedAt: "2026-05-11T10:00:00.000Z",
      expiresAt: "2026-05-12T09:00:00.000Z",
      status: "200"
    });

    const result = await resolveWithCacheFallback({
      cache: store,
      key: "typescript",
      sourceType: "typescript-docs",
      now: "2026-05-12T10:00:00.000Z",
      ttlMs: 60_000,
      fetchFresh: async () => {
        throw new Error("network unavailable");
      }
    });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.cacheStatus).toBe("stale");
      expect(result.content).toBe("stale docs");
      expect(result.confidence).toBe("low");
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]?.title).toContain("stale cache");
    }

    store.close();
  });

  test("live fetch failure plus no cache returns structured no-evidence error", async () => {
    const store = createStore();

    const result = await resolveWithCacheFallback({
      cache: store,
      key: "missing",
      sourceType: "bun-docs",
      sourceUrl: "https://bun.com/docs/missing",
      now: "2026-05-12T10:00:00.000Z",
      ttlMs: 60_000,
      fetchFresh: async () => {
        throw new Error("network unavailable");
      }
    });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe("no_evidence");
      expect(result.error.details).toEqual({
        sourceUrl: "https://bun.com/docs/missing",
        reason: "network unavailable"
      });
    }

    store.close();
  });
});
