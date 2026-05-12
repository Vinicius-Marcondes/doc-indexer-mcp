import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { SqliteCacheStore } from "../../../src/cache/sqlite-cache";
import {
  NpmRegistryAdapter,
  npmRegistryPackageUrl,
  parseNpmPackageMetadata
} from "../../../src/sources/npm-registry";
import { SourceFetchClient, type FetchLike } from "../../../src/sources/fetch-client";

const tempDirs: string[] = [];

const unscopedMetadata = {
  name: "fixture-lib",
  "dist-tags": {
    latest: "2.0.0"
  },
  versions: {
    "1.0.0": {
      name: "fixture-lib",
      version: "1.0.0",
      deprecated: "Use fixture-lib 2.x",
      peerDependencies: {
        react: "^18.0.0"
      },
      engines: {
        node: ">=18"
      }
    },
    "2.0.0": {
      name: "fixture-lib",
      version: "2.0.0",
      peerDependencies: {
        typescript: ">=5"
      },
      engines: {
        bun: ">=1.2.0"
      }
    }
  },
  time: {
    "1.0.0": "2024-01-01T00:00:00.000Z",
    "2.0.0": "2026-01-01T00:00:00.000Z"
  }
};

const scopedMetadata = {
  name: "@scope/pkg",
  "dist-tags": {
    latest: "1.2.3"
  },
  versions: {
    "1.2.3": {
      name: "@scope/pkg",
      version: "1.2.3"
    }
  },
  time: {
    "1.2.3": "2026-02-01T00:00:00.000Z"
  }
};

function createStore(): SqliteCacheStore {
  const dir = mkdtempSync(resolve(tmpdir(), "bun-dev-intel-npm-"));
  tempDirs.push(dir);
  return new SqliteCacheStore(resolve(dir, "cache.sqlite"));
}

function createAdapter(fetchImpl: FetchLike, store = createStore()): NpmRegistryAdapter {
  return new NpmRegistryAdapter({
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

describe("npm registry metadata", () => {
  test("parses unscoped package metadata", () => {
    const metadata = parseNpmPackageMetadata(
      JSON.stringify(unscopedMetadata),
      npmRegistryPackageUrl("fixture-lib"),
      "2026-05-12T10:00:00.000Z"
    );

    expect(metadata.name).toBe("fixture-lib");
    expect(metadata.latestVersion).toBe("2.0.0");
    expect(metadata.versions["2.0.0"]?.publishedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  test("parses scoped package metadata and encodes package URL", async () => {
    const calls: string[] = [];
    const adapter = createAdapter(async (url) => {
      calls.push(url);
      return new Response(JSON.stringify(scopedMetadata), { status: 200 });
    });

    const result = await adapter.fetchPackageMetadata("@scope/pkg");

    expect(calls).toEqual(["https://registry.npmjs.org/%40scope%2Fpkg"]);
    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.metadata.name).toBe("@scope/pkg");
      expect(result.metadata.latestVersion).toBe("1.2.3");
      expect(result.sources[0]?.url).toBe("https://registry.npmjs.org/%40scope%2Fpkg");
    }
  });

  test("extracts dist-tags.latest", () => {
    const metadata = parseNpmPackageMetadata(
      JSON.stringify(unscopedMetadata),
      npmRegistryPackageUrl("fixture-lib"),
      "2026-05-12T10:00:00.000Z"
    );

    expect(metadata.distTags.latest).toBe("2.0.0");
    expect(metadata.latestVersion).toBe("2.0.0");
  });

  test("extracts peer dependencies and engines", () => {
    const metadata = parseNpmPackageMetadata(
      JSON.stringify(unscopedMetadata),
      npmRegistryPackageUrl("fixture-lib"),
      "2026-05-12T10:00:00.000Z"
    );

    expect(metadata.versions["2.0.0"]?.peerDependencies).toEqual({
      typescript: ">=5"
    });
    expect(metadata.versions["2.0.0"]?.engines).toEqual({
      bun: ">=1.2.0"
    });
  });

  test("detects deprecated package versions", () => {
    const metadata = parseNpmPackageMetadata(
      JSON.stringify(unscopedMetadata),
      npmRegistryPackageUrl("fixture-lib"),
      "2026-05-12T10:00:00.000Z"
    );

    expect(metadata.deprecations).toEqual([
      {
        version: "1.0.0",
        message: "Use fixture-lib 2.x"
      }
    ]);
  });

  test("handles 404 without fabricated package data", async () => {
    const adapter = createAdapter(async () => new Response("not found", { status: 404, statusText: "Not Found" }));

    const result = await adapter.fetchPackageMetadata("missing-package");

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe("fetch_failed");
      expect(result.error.details?.status).toBe(404);
    }
  });

  test("uses stale cache on network failure", async () => {
    const store = createStore();
    store.set({
      key: npmRegistryPackageUrl("fixture-lib"),
      sourceType: "npm-registry",
      sourceUrl: npmRegistryPackageUrl("fixture-lib"),
      content: JSON.stringify(unscopedMetadata),
      fetchedAt: "2026-05-12T08:00:00.000Z",
      expiresAt: "2026-05-12T09:00:00.000Z",
      status: "200"
    });
    const adapter = createAdapter(
      async () => {
        throw new Error("network unavailable");
      },
      store
    );

    const result = await adapter.fetchPackageMetadata("fixture-lib");

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.cacheStatus).toBe("stale");
      expect(result.confidence).toBe("low");
      expect(result.warnings).toHaveLength(1);
      expect(result.metadata.latestVersion).toBe("2.0.0");
    }

    store.close();
  });
});
