import { describe, expect, test } from "bun:test";
import { searchBunDocs } from "../../../src/tools/search-bun-docs";
import type { DocsRetrievalInput, DocsRetrievalResult } from "../../../src/docs/retrieval/hybrid-retrieval";
import { defaultDocsSourceRegistry } from "../../../src/docs/sources/bun-source-pack";

const generatedAt = "2026-05-14T12:00:00.000Z";

function docsResult(input: DocsRetrievalInput): DocsRetrievalResult {
  const packageManagerBoost = input.query.includes("bun.lock");

  return {
    query: input.query.trim(),
    sourceId: "bun",
    mode: "hybrid",
    limit: input.limit ?? 5,
    results: [
      packageManagerBoost
        ? {
            chunkId: 2,
            pageId: 20,
            title: "Lockfile",
            url: "https://bun.com/docs/pm/lockfile",
            headingPath: ["Package manager", "Lockfile"],
            snippet: "Bun uses bun.lock for dependency resolution.",
            score: 5,
            keywordScore: 4,
            vectorScore: 0.6,
            rerankScore: 1,
            fetchedAt: "2026-05-14T10:00:00.000Z",
            indexedAt: "2026-05-14T10:05:00.000Z",
            contentHash: "chunk-lockfile"
          }
        : {
            chunkId: 1,
            pageId: 10,
            title: "TypeScript",
            url: "https://bun.com/docs/runtime/typescript",
            headingPath: ["Runtime", "TypeScript"],
            snippet: "Install @types/bun and set types to bun for Bun TypeScript projects.",
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
      mode: "hybrid",
      keywordAttempted: true,
      vectorAttempted: true,
      keywordResultCount: 1,
      vectorResultCount: 1,
      mergedResultCount: 1,
      queryHash: packageManagerBoost ? "lockfile-hash" : "typescript-hash"
    },
    warnings: []
  };
}

class StubDocsRetrieval {
  readonly calls: DocsRetrievalInput[] = [];
  lowConfidence = false;

  async search(input: DocsRetrievalInput): Promise<DocsRetrievalResult> {
    this.calls.push(input);
    const result = docsResult(input);

    if (!this.lowConfidence) {
      return result;
    }

    return {
      ...result,
      results: [],
      freshness: "missing",
      confidence: "low",
      lowConfidence: true,
      refreshReason: "missing_content",
      retrieval: {
        ...result.retrieval,
        keywordResultCount: 0,
        vectorResultCount: 0,
        mergedResultCount: 0
      },
      warnings: [{ code: "no_results", message: "No indexed documentation evidence matched the query." }]
    };
  }
}

function dependencies(retrieval: StubDocsRetrieval) {
  return {
    retrieval,
    sourceRegistry: defaultDocsSourceRegistry,
    now: () => generatedAt,
    defaultLimit: 5,
    maxLimit: 20
  };
}

describe("search_bun_docs compatibility wrapper", () => {
  test("TypeScript query delegates to docs retrieval and returns Bun result", async () => {
    const retrieval = new StubDocsRetrieval();
    const result = await searchBunDocs(
      { query: "typescript types bun", topic: "typescript" },
      dependencies(retrieval)
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected search_bun_docs success.");
    }
    expect(retrieval.calls[0]).toMatchObject({
      sourceId: "bun",
      mode: "hybrid",
      limit: 5
    });
    expect(retrieval.calls[0]?.query).toContain("@types/bun");
    expect(result.query).toBe("typescript types bun");
    expect(result.results[0]).toMatchObject({
      title: "TypeScript",
      url: "https://bun.com/docs/runtime/typescript",
      relevanceScore: 4
    });
    expect(result.sources[0]?.url).toBe("https://bun.com/docs/runtime/typescript");
    expect(result.freshness).toBe("fresh");
  });

  test("topic boost affects deterministic ranking", async () => {
    const retrieval = new StubDocsRetrieval();
    const result = await searchBunDocs(
      { query: "dependency resolution", topic: "package-manager" },
      dependencies(retrieval)
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected search_bun_docs success.");
    }
    expect(retrieval.calls[0]?.query).toContain("bun.lock");
    expect(result.results[0]?.title).toBe("Lockfile");
  });

  test("invalid topic fails validation", async () => {
    const result = await searchBunDocs(
      { query: "typescript", topic: "invalid-topic" },
      dependencies(new StubDocsRetrieval())
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("invalid_input");
    }
  });

  test("low-confidence result includes warning", async () => {
    const retrieval = new StubDocsRetrieval();
    retrieval.lowConfidence = true;
    const result = await searchBunDocs({ query: "no indexed evidence" }, dependencies(retrieval));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected low-confidence success response.");
    }
    expect(result.confidence).toBe("low");
    expect(result.freshness).toBe("missing");
    expect(result.warnings.map((warning) => warning.id)).toContain("no_results");
  });

  test("result includes hybrid retrieval metadata", async () => {
    const result = await searchBunDocs({ query: "typescript" }, dependencies(new StubDocsRetrieval()));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected search_bun_docs success.");
    }
    expect(result.retrieval).toMatchObject({
      mode: "hybrid",
      keywordAttempted: true,
      vectorAttempted: true,
      mergedResultCount: 1
    });
    expect(result.refreshQueued).toBe(false);
  });
});
