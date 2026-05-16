import { describe, expect, test } from "bun:test";
import { searchDocs } from "../../../packages/docs-domain/src/tools/search-docs";
import {
  HybridDocsRetrieval,
  type DocsRetrievalInput,
  type DocsRetrievalResult
} from "../../../packages/docs-domain/src/docs/retrieval/hybrid-retrieval";
import type { KeywordSearchInput, KeywordSearchResult } from "../../../packages/docs-domain/src/docs/retrieval/keyword-retrieval";
import type { VectorSearchInput, VectorSearchResult } from "../../../packages/docs-domain/src/docs/retrieval/vector-retrieval";
import { defaultDocsSourceRegistry } from "../../../packages/docs-domain/src/docs/sources/bun-source-pack";
import type { EnqueueRefreshJobInput } from "../../../packages/docs-domain/src/docs/refresh/refresh-queue";

const generatedAt = "2026-05-14T12:00:00.000Z";

function retrievalResult(overrides: Partial<DocsRetrievalResult> = {}): DocsRetrievalResult {
  return {
    query: "Bun.serve",
    sourceId: "bun",
    mode: "hybrid",
    limit: 5,
    results: [
      {
        chunkId: 1,
        pageId: 10,
        title: "HTTP server",
        url: "https://bun.com/docs/runtime/http-server",
        headingPath: ["Runtime", "HTTP server"],
        snippet: "Use Bun.serve to start an HTTP server with a fetch handler.",
        score: 4.5,
        keywordScore: 3,
        vectorScore: 0.8,
        rerankScore: 2,
        fetchedAt: "2026-05-14T11:00:00.000Z",
        indexedAt: "2026-05-14T11:00:00.000Z",
        contentHash: "chunk-1"
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
      queryHash: "hash"
    },
    warnings: [],
    ...overrides
  };
}

class StubDocsRetrieval {
  readonly calls: DocsRetrievalInput[] = [];

  constructor(private readonly result: DocsRetrievalResult) {}

  async search(input: DocsRetrievalInput): Promise<DocsRetrievalResult> {
    this.calls.push(input);
    return {
      ...this.result,
      query: input.query.trim(),
      sourceId: input.sourceId,
      mode: input.mode ?? "hybrid",
      limit: input.limit ?? 5,
      retrieval: {
        ...this.result.retrieval,
        mode: input.mode ?? "hybrid"
      }
    };
  }
}

class StubKeywordRetrieval {
  async search(input: KeywordSearchInput): Promise<KeywordSearchResult> {
    return {
      sourceId: input.sourceId,
      query: input.query.trim(),
      limit: input.limit ?? 5,
      results: [
        {
          chunkId: 1,
          pageId: 10,
          title: "HTTP server",
          url: "https://bun.com/docs/runtime/http-server",
          headingPath: ["Runtime", "HTTP server"],
          snippet: "Use Bun.serve to start an HTTP server.",
          score: 3,
          keywordScore: 3,
          vectorScore: 0,
          rerankScore: 0,
          fetchedAt: "2026-05-14T11:00:00.000Z",
          indexedAt: "2026-05-14T11:00:00.000Z",
          contentHash: "chunk-1"
        }
      ]
    };
  }
}

class StubRefreshQueue {
  readonly calls: EnqueueRefreshJobInput[] = [];

  async enqueue(input: EnqueueRefreshJobInput) {
    this.calls.push(input);
    return {
      status: "queued" as const,
      priority: 75,
      runAfter: generatedAt,
      job: {
        id: this.calls.length,
        sourceId: input.sourceId,
        url: input.url ?? null,
        jobType: input.jobType,
        reason: input.reason,
        status: "queued" as const,
        priority: 75,
        runAfter: generatedAt
      }
    };
  }
}

class ThrowingVectorRetrieval {
  calls = 0;

  async search(_input: VectorSearchInput): Promise<VectorSearchResult> {
    this.calls += 1;
    throw new Error("Semantic retrieval should not be called for keyword mode.");
  }
}

function dependencies(retrieval: StubDocsRetrieval | HybridDocsRetrieval) {
  return {
    retrieval,
    sourceRegistry: defaultDocsSourceRegistry,
    now: () => generatedAt,
    defaultLimit: 5,
    maxLimit: 20
  };
}

describe("search_docs tool", () => {
  test("valid query returns hybrid docs results with citations", async () => {
    const retrieval = new StubDocsRetrieval(retrievalResult());
    const result = await searchDocs({ query: "Bun.serve" }, dependencies(retrieval));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected search_docs success.");
    }
    expect(retrieval.calls[0]).toMatchObject({
      sourceId: "bun",
      query: "Bun.serve",
      mode: "hybrid",
      limit: 5
    });
    expect(result).toMatchObject({
      generatedAt,
      query: "Bun.serve",
      sourceId: "bun",
      mode: "hybrid",
      freshness: "fresh",
      confidence: "high",
      refreshQueued: false
    });
    expect(result.results[0]).toMatchObject({
      title: "HTTP server",
      url: "https://bun.com/docs/runtime/http-server",
      keywordScore: 3,
      vectorScore: 0.8
    });
    expect(result.sources).toEqual([
      {
        title: "HTTP server",
        url: "https://bun.com/docs/runtime/http-server",
        sourceType: "bun-docs",
        fetchedAt: "2026-05-14T11:00:00.000Z",
        contentHash: "chunk-1"
      }
    ]);
  });

  test("keyword mode avoids embedding provider", async () => {
    const vectorRetrieval = new ThrowingVectorRetrieval();
    const hybrid = new HybridDocsRetrieval({
      keywordRetrieval: new StubKeywordRetrieval(),
      vectorRetrieval,
      now: () => new Date(generatedAt),
      defaultLimit: 5,
      maxLimit: 20
    });

    const result = await searchDocs({ query: "Bun.serve", mode: "keyword" }, dependencies(hybrid));

    expect(result.ok).toBe(true);
    expect(vectorRetrieval.calls).toBe(0);
    if (!result.ok) {
      throw new Error("Expected search_docs success.");
    }
    expect(result.mode).toBe("keyword");
    expect(result.retrieval.vectorAttempted).toBe(false);
  });

  test("invalid mode fails validation", async () => {
    const result = await searchDocs({ query: "Bun.serve", mode: "bad" }, dependencies(new StubDocsRetrieval(retrievalResult())));

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected invalid mode failure.");
    }
    expect(result.error.code).toBe("invalid_input");
  });

  test("invalid source fails validation", async () => {
    const result = await searchDocs({ query: "Bun.serve", sourceId: "other" }, dependencies(new StubDocsRetrieval(retrievalResult())));

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected invalid source failure.");
    }
    expect(result.error.code).toBe("disallowed_source");
  });

  test("limit above max is rejected", async () => {
    const result = await searchDocs({ query: "Bun.serve", limit: 200 }, dependencies(new StubDocsRetrieval(retrievalResult())));

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected limit validation failure.");
    }
    expect(result.error.code).toBe("invalid_input");
    expect(result.error.details).toMatchObject({
      maxLimit: 20
    });
  });

  test("empty result includes warning and low confidence", async () => {
    const result = await searchDocs(
      { query: "missing evidence" },
      dependencies(
        new StubDocsRetrieval(
          retrievalResult({
            results: [],
            freshness: "missing",
            confidence: "low",
            lowConfidence: true,
            refreshReason: "missing_content",
            retrieval: {
              mode: "hybrid",
              keywordAttempted: true,
              vectorAttempted: true,
              keywordResultCount: 0,
              vectorResultCount: 0,
              mergedResultCount: 0,
              queryHash: "hash"
            },
            warnings: [{ code: "no_results", message: "No indexed documentation evidence matched the query." }]
          })
        )
      )
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected search_docs success.");
    }
    expect(result.results).toEqual([]);
    expect(result.sources).toEqual([]);
    expect(result.confidence).toBe("low");
    expect(result.refreshReason).toBe("missing_content");
    expect(result.warnings.map((warning) => warning.code)).toContain("no_results");
  });

  test("low-confidence search enqueues refresh and returns promptly", async () => {
    const refreshQueue = new StubRefreshQueue();
    const result = await searchDocs(
      { query: "missing evidence" },
      {
        ...dependencies(
          new StubDocsRetrieval(
            retrievalResult({
              results: [],
              freshness: "missing",
              confidence: "low",
              lowConfidence: true,
              refreshReason: "missing_content",
              retrieval: {
                mode: "hybrid",
                keywordAttempted: true,
                vectorAttempted: true,
                keywordResultCount: 0,
                vectorResultCount: 0,
                mergedResultCount: 0,
                queryHash: "hash"
              },
              warnings: [{ code: "no_results", message: "No indexed documentation evidence matched the query." }]
            })
          )
        ),
        refreshQueue
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected search_docs success.");
    }
    expect(result.refreshQueued).toBe(true);
    expect(refreshQueue.calls).toHaveLength(1);
    expect(refreshQueue.calls[0]).toMatchObject({
      sourceId: "bun",
      jobType: "source_index",
      reason: "missing_content"
    });
  });

  test("every result has citation metadata", async () => {
    const result = await searchDocs({ query: "Bun.serve" }, dependencies(new StubDocsRetrieval(retrievalResult())));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected search_docs success.");
    }
    expect(result.results).toHaveLength(1);
    for (const item of result.results) {
      const citation = result.sources.find((source) => source.url === item.url);
      expect(citation).toBeDefined();
      expect(citation?.fetchedAt).toBe(item.fetchedAt);
      expect(citation?.contentHash).toBe(item.contentHash);
    }
  });
});
