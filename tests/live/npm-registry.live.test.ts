import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { SqliteCacheStore } from "../../src/cache/sqlite-cache";
import { NpmRegistryAdapter } from "../../src/sources/npm-registry";
import { SourceFetchClient } from "../../src/sources/fetch-client";

const liveTest = process.env.LIVE_DOCS === "1" ? test : test.skip;
const tempDirs: string[] = [];

function createStore(): SqliteCacheStore {
  const dir = mkdtempSync(resolve(tmpdir(), "bun-dev-intel-live-npm-"));
  tempDirs.push(dir);
  return new SqliteCacheStore(resolve(dir, "cache.sqlite"));
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("live npm registry source", () => {
  liveTest("fetches TypeScript metadata and finds a latest dist-tag", async () => {
    const store = createStore();
    const adapter = new NpmRegistryAdapter({
      cache: store,
      fetchClient: new SourceFetchClient()
    });

    const result = await adapter.fetchPackageMetadata("typescript");

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.metadata.name).toBe("typescript");
      expect(result.metadata.distTags.latest).toBeString();
      expect(result.metadata.distTags.latest?.length).toBeGreaterThan(0);
    }

    store.close();
  });
});
