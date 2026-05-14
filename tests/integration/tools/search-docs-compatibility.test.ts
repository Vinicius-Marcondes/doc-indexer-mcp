import { describe, expect, test } from "bun:test";
import { searchDocs } from "../../../src/tools/search-docs";
import { searchBunDocs } from "../../../src/tools/search-bun-docs";
import type { DocsRetrievalInput, DocsRetrievalResult } from "../../../src/docs/retrieval/hybrid-retrieval";
import { defaultDocsSourceRegistry } from "../../../src/docs/sources/bun-source-pack";

class SharedRetrieval {
  readonly calls: DocsRetrievalInput[] = [];

  async search(input: DocsRetrievalInput): Promise<DocsRetrievalResult> {
    this.calls.push(input);
    return {
      query: input.query.trim(),
      sourceId: "bun",
      mode: input.mode ?? "hybrid",
      limit: input.limit ?? 5,
      results: [
        {
          chunkId: 1,
          pageId: 10,
          title: "TypeScript",
          url: "https://bun.com/docs/runtime/typescript",
          headingPath: ["Runtime", "TypeScript"],
          snippet: "Install @types/bun for Bun TypeScript projects.",
          score: 4,
          keywordScore: 3,
          vectorScore: 0.7,
          rerankScore: 1,
          fetchedAt: "2026-05-14T10:00:00.000Z",
          indexedAt: "2026-05-14T10:05:00.000Z",
          contentHash: "chunk-typescript"
        }
      ],
      freshness: "fresh",
      confidence: "high",
      lowConfidence: false,
      refreshQueued: false,
      retrieval: {
        mode: input.mode ?? "hybrid",
        keywordAttempted: true,
        vectorAttempted: true,
        keywordResultCount: 1,
        vectorResultCount: 1,
        mergedResultCount: 1,
        queryHash: "shared-hash"
      },
      warnings: []
    };
  }
}

function dependencies(retrieval: SharedRetrieval) {
  return {
    retrieval,
    sourceRegistry: defaultDocsSourceRegistry,
    now: () => "2026-05-14T12:00:00.000Z",
    defaultLimit: 5,
    maxLimit: 20
  };
}

describe("search docs compatibility", () => {
  test("search_bun_docs and search_docs with sourceId bun use the same underlying result path", async () => {
    const retrieval = new SharedRetrieval();
    const deps = dependencies(retrieval);
    const bunResult = await searchBunDocs({ query: "typescript" }, deps);
    const genericResult = await searchDocs({ sourceId: "bun", query: "typescript" }, deps);

    expect(bunResult.ok).toBe(true);
    expect(genericResult.ok).toBe(true);

    if (!bunResult.ok || !genericResult.ok) {
      throw new Error("Expected both search tools to succeed.");
    }

    expect(retrieval.calls).toHaveLength(2);
    expect(retrieval.calls.every((call) => call.sourceId === "bun")).toBe(true);
    expect(bunResult.results[0]?.url).toBe(genericResult.results[0]?.url);
    expect(bunResult.sources[0]?.url).toBe(genericResult.sources[0]?.url);
    expect(bunResult.retrieval.queryHash).toBe(genericResult.retrieval.queryHash);
  });
});
