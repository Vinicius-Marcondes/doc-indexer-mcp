import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { SqliteCacheStore, computeContentHash } from "../../../src/cache/sqlite-cache";

const tempDirs: string[] = [];

function createStore(): SqliteCacheStore {
  const dir = mkdtempSync(resolve(tmpdir(), "bun-dev-intel-cache-"));
  tempDirs.push(dir);
  return new SqliteCacheStore(resolve(dir, "cache.sqlite"));
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("SQLite cache store", () => {
  test("creates cache schema", () => {
    const store = createStore();

    expect(existsSync(store.path)).toBe(true);
    expect(store.hasSchema()).toBe(true);

    store.close();
  });

  test("stores and retrieves content with hash metadata", () => {
    const store = createStore();
    const fetchedAt = "2026-05-12T10:00:00.000Z";
    const expiresAt = "2026-05-13T10:00:00.000Z";

    store.set({
      key: "https://bun.com/docs/llms.txt",
      sourceType: "bun-docs",
      sourceUrl: "https://bun.com/docs/llms.txt",
      content: "Bun docs",
      fetchedAt,
      expiresAt,
      status: "200"
    });

    const result = store.get("https://bun.com/docs/llms.txt", "bun-docs", "2026-05-12T11:00:00.000Z");

    expect(result.cacheStatus).toBe("fresh");

    if (result.cacheStatus === "fresh") {
      expect(result.entry.content).toBe("Bun docs");
      expect(result.entry.contentHash).toBe(computeContentHash("Bun docs"));
      expect(result.entry.fetchedAt).toBe(fetchedAt);
      expect(result.entry.expiresAt).toBe(expiresAt);
      expect(result.entry.status).toBe("200");
    }

    store.close();
  });

  test("computes stable content hashes from normalized content", () => {
    expect(computeContentHash("Bun docs\n")).toBe(computeContentHash("Bun docs"));
    expect(computeContentHash("Bun docs")).not.toBe(computeContentHash("TypeScript docs"));
  });

  test("marks entries fresh before TTL and stale after TTL", () => {
    const store = createStore();

    store.set({
      key: "typescript",
      sourceType: "typescript-docs",
      content: "TS docs",
      fetchedAt: "2026-05-12T10:00:00.000Z",
      expiresAt: "2026-05-12T12:00:00.000Z",
      status: "200"
    });

    expect(store.get("typescript", "typescript-docs", "2026-05-12T11:00:00.000Z").cacheStatus).toBe("fresh");
    expect(store.get("typescript", "typescript-docs", "2026-05-12T12:00:01.000Z").cacheStatus).toBe("stale");

    store.close();
  });

  test("separates entries by key and source type", () => {
    const store = createStore();
    const fetchedAt = "2026-05-12T10:00:00.000Z";
    const expiresAt = "2026-05-13T10:00:00.000Z";

    store.set({
      key: "shared-key",
      sourceType: "bun-docs",
      content: "Bun",
      fetchedAt,
      expiresAt,
      status: "200"
    });
    store.set({
      key: "shared-key",
      sourceType: "mcp-docs",
      content: "MCP",
      fetchedAt,
      expiresAt,
      status: "200"
    });

    const bunEntry = store.get("shared-key", "bun-docs", fetchedAt);
    const mcpEntry = store.get("shared-key", "mcp-docs", fetchedAt);
    const missingEntry = store.get("shared-key", "npm-registry", fetchedAt);

    expect(bunEntry.cacheStatus).toBe("fresh");
    expect(mcpEntry.cacheStatus).toBe("fresh");
    expect(missingEntry.cacheStatus).toBe("miss");

    if (bunEntry.cacheStatus === "fresh" && mcpEntry.cacheStatus === "fresh") {
      expect(bunEntry.entry.content).toBe("Bun");
      expect(mcpEntry.entry.content).toBe("MCP");
    }

    store.close();
  });
});
