import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { SqliteCacheStore } from "../../src/cache/sqlite-cache";
import { BunDocsIndexAdapter } from "../../src/sources/bun-docs-index";
import { SourceFetchClient } from "../../src/sources/fetch-client";

const liveTest = process.env.LIVE_DOCS === "1" ? test : test.skip;
const tempDirs: string[] = [];

function createStore(): SqliteCacheStore {
  const dir = mkdtempSync(resolve(tmpdir(), "bun-dev-intel-live-docs-"));
  tempDirs.push(dir);
  return new SqliteCacheStore(resolve(dir, "cache.sqlite"));
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("live Bun docs source", () => {
  liveTest("fetches Bun docs index and finds at least one page", async () => {
    const store = createStore();
    const adapter = new BunDocsIndexAdapter({
      cache: store,
      fetchClient: new SourceFetchClient()
    });

    const result = await adapter.listPages();

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.pages.length).toBeGreaterThan(0);
      expect(result.pages.some((page) => page.url.startsWith("https://bun.com/docs/"))).toBe(true);
    }

    store.close();
  });
});
