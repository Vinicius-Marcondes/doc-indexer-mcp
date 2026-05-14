import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SqliteCacheStore } from "../../src/cache/sqlite-cache";
import { BUN_DOCS_INDEX_URL, BunDocsIndexAdapter } from "../../src/sources/bun-docs-index";
import { BUN_DOCS_FULL_URL } from "../../src/sources/bun-docs-search";
import { NpmRegistryAdapter, npmRegistryPackageUrl } from "../../src/sources/npm-registry";
import { SourceFetchClient, type FetchLike } from "../../src/sources/fetch-client";
import { analyzeBunProject } from "../../src/tools/analyze-bun-project";
import { searchBunDocs } from "../../src/tools/search-bun-docs";
import { planBunDependency } from "../../src/tools/plan-bun-dependency";
import { reviewBunProject } from "../../src/tools/review-bun-project";
import type { Recommendation } from "../../src/shared/contracts";
import { defaultDocsSourceRegistry } from "../../src/docs/sources/bun-source-pack";
import type { DocsRetrievalInput, DocsRetrievalResult } from "../../src/docs/retrieval/hybrid-retrieval";

const testDir = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(testDir, "../fixtures/projects");
const tempDirs: string[] = [];
const now = "2026-05-12T10:00:00.000Z";

const docsIndex = `# Bun docs

- [TypeScript](https://bun.com/docs/runtime/typescript)
- [Lockfile](https://bun.com/docs/pm/lockfile)
- [Test runner](https://bun.com/docs/test)
`;

const docsFull = `# TypeScript
URL: https://bun.com/docs/runtime/typescript
Install @types/bun and use compilerOptions.types ["bun"] with moduleResolution bundler.

# Lockfile
URL: https://bun.com/docs/pm/lockfile
Bun uses bun.lock. Legacy bun.lockb should be migrated.

# Test runner
URL: https://bun.com/docs/test
Use bun test with imports from bun:test.
`;

const npmMetadata = JSON.stringify({
  name: "typescript",
  "dist-tags": {
    latest: "5.9.3"
  },
  versions: {
    "5.9.3": {
      version: "5.9.3",
      peerDependencies: {},
      engines: {
        node: ">=14.17"
      }
    }
  },
  time: {
    "5.9.3": "2026-05-01T00:00:00.000Z"
  }
});

function createStore(): SqliteCacheStore {
  const dir = mkdtempSync(resolve(tmpdir(), "bun-dev-intel-e2e-"));
  tempDirs.push(dir);
  return new SqliteCacheStore(resolve(dir, "cache.sqlite"));
}

function createFetch(): FetchLike {
  return async (url) => {
    const href = String(url);

    if (href === BUN_DOCS_INDEX_URL) {
      return new Response(docsIndex, { status: 200 });
    }

    if (href === BUN_DOCS_FULL_URL) {
      return new Response(docsFull, { status: 200 });
    }

    if (href === npmRegistryPackageUrl("typescript")) {
      return new Response(npmMetadata, { status: 200 });
    }

    throw new Error(`unexpected e2e fetch: ${href}`);
  };
}

function expectRecommendationsCited(recommendations: readonly Recommendation[]): void {
  expect(recommendations.length).toBeGreaterThan(0);

  for (const recommendation of recommendations) {
    expect(recommendation.evidence.length).toBeGreaterThan(0);
    expect(recommendation.sources.length).toBeGreaterThan(0);
  }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("Bun Dev Intelligence offline flow", () => {
  test("analyze, inspect docs, plan dependency, and review project with cited recommendations", async () => {
    const store = createStore();
    const fetchClient = new SourceFetchClient({
      fetchImpl: createFetch(),
      now: () => now
    });
    const docsRetrieval = {
      search: async (input: DocsRetrievalInput): Promise<DocsRetrievalResult> => ({
        query: input.query,
        sourceId: "bun",
        mode: "hybrid",
        limit: input.limit ?? 5,
        results: [
          {
            chunkId: 1,
            pageId: 1,
            title: "TypeScript",
            url: "https://bun.com/docs/runtime/typescript",
            headingPath: ["Runtime", "TypeScript"],
            snippet: "Install @types/bun and use compilerOptions.types bun.",
            score: 4,
            keywordScore: 3,
            vectorScore: 0.7,
            rerankScore: 1,
            fetchedAt: now,
            indexedAt: now,
            contentHash: "typescript-chunk"
          }
        ],
        freshness: "fresh",
        confidence: "high",
        lowConfidence: false,
        refreshQueued: false,
        retrieval: {
          mode: "hybrid",
          keywordAttempted: true,
          vectorAttempted: true,
          keywordResultCount: 1,
          vectorResultCount: 1,
          mergedResultCount: 1,
          queryHash: "e2e-hash"
        },
        warnings: []
      })
    };
    const docsIndexAdapter = new BunDocsIndexAdapter({
      cache: store,
      fetchClient,
      now: () => now
    });
    const registryAdapter = new NpmRegistryAdapter({
      cache: store,
      fetchClient,
      now: () => now
    });
    const projectPath = resolve(fixturesDir, "missing-bun-types");

    const analysis = analyzeBunProject({ projectPath });
    expect(analysis.ok).toBe(true);

    if (!analysis.ok) {
      throw new Error("analysis failed");
    }

    expect(analysis.recommendations.map((recommendation) => recommendation.id)).toContain("missing-types-bun-package");
    expectRecommendationsCited(analysis.recommendations);

    const index = await docsIndexAdapter.listPages();
    expect(index.ok).toBe(true);

    if (index.ok) {
      expect(index.pages.map((page) => page.url)).toContain("https://bun.com/docs/runtime/typescript");
    }

    const docs = await searchBunDocs(
      { query: "typescript types bun", topic: "typescript" },
      {
        retrieval: docsRetrieval,
        sourceRegistry: defaultDocsSourceRegistry,
        now: () => now,
        defaultLimit: 5,
        maxLimit: 20
      }
    );
    expect(docs.ok).toBe(true);

    if (docs.ok) {
      expect(docs.results[0]?.url).toBe("https://bun.com/docs/runtime/typescript");
      expect(docs.sources.length).toBeGreaterThan(0);
    }

    const dependencyPlan = await planBunDependency(
      {
        projectPath,
        packages: [{ name: "typescript" }],
        dependencyType: "devDependencies"
      },
      { registryAdapter }
    );
    expect(dependencyPlan.ok).toBe(true);

    if (dependencyPlan.ok) {
      expect(dependencyPlan.installCommand).toBe("bun add -d typescript");
      expectRecommendationsCited(dependencyPlan.recommendations);
    }

    const review = reviewBunProject({ projectPath, focus: "all" });
    expect(review.ok).toBe(true);

    if (review.ok) {
      expect(review.keyRisks.length).toBeGreaterThan(0);
      expect(review.warnings.map((warning) => warning.id)).toContain("dependency-latest-compatibility-warning");
      expectRecommendationsCited(review.recommendedNextActions);
    }

    store.close();
  });
});
