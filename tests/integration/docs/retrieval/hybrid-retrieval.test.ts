import { describe, expect, test } from "bun:test";
import {
  HybridDocsRetrieval,
  hashRetrievalQuery,
  type DocsRetrievalTelemetryRecorder
} from "../../../../src/docs/retrieval/hybrid-retrieval";
import type {
  KeywordRetrievalResultItem,
  KeywordSearchInput,
  KeywordSearchResult
} from "../../../../src/docs/retrieval/keyword-retrieval";
import type {
  VectorRetrievalResultItem,
  VectorSearchInput,
  VectorSearchResult
} from "../../../../src/docs/retrieval/vector-retrieval";
import { createStructuredError } from "../../../../src/shared/errors";

const freshNow = new Date("2026-05-14T12:00:00.000Z");

function keywordItem(overrides: Partial<KeywordRetrievalResultItem> = {}): KeywordRetrievalResultItem {
  return {
    chunkId: 1,
    pageId: 10,
    title: "HTTP server",
    url: "https://bun.com/docs/runtime/http-server",
    headingPath: ["Runtime", "HTTP server"],
    snippet: "Use Bun.serve to start an HTTP server with a fetch handler.",
    score: 3,
    keywordScore: 3,
    vectorScore: 0,
    rerankScore: 0,
    fetchedAt: "2026-05-14T11:00:00.000Z",
    indexedAt: "2026-05-14T11:00:00.000Z",
    contentHash: "chunk-1",
    ...overrides
  };
}

function vectorItem(overrides: Partial<VectorRetrievalResultItem> = {}): VectorRetrievalResultItem {
  return {
    chunkId: 2,
    pageId: 20,
    title: "Background refresh",
    url: "https://bun.com/docs/runtime/background-refresh",
    headingPath: ["Runtime", "Background refresh"],
    snippet: "Refresh jobs run outside user requests so docs indexing stays responsive.",
    score: 0.92,
    keywordScore: 0,
    vectorScore: 0.92,
    rerankScore: 0,
    fetchedAt: "2026-05-14T10:00:00.000Z",
    indexedAt: "2026-05-14T10:00:00.000Z",
    contentHash: "chunk-2",
    ...overrides
  };
}

class StubKeywordRetrieval {
  calls: KeywordSearchInput[] = [];

  constructor(private readonly results: readonly KeywordRetrievalResultItem[]) {}

  async search(input: KeywordSearchInput): Promise<KeywordSearchResult> {
    this.calls.push(input);
    return {
      sourceId: input.sourceId,
      query: input.query.trim(),
      limit: input.limit ?? 5,
      results: this.results
    };
  }
}

class StubVectorRetrieval {
  calls: VectorSearchInput[] = [];

  constructor(private readonly result: VectorSearchResult) {}

  async search(input: VectorSearchInput): Promise<VectorSearchResult> {
    this.calls.push(input);
    return this.result;
  }
}

class ThrowingVectorRetrieval {
  calls: VectorSearchInput[] = [];

  async search(input: VectorSearchInput): Promise<VectorSearchResult> {
    this.calls.push(input);
    throw new Error("Semantic retrieval should not be called.");
  }
}

class CapturingTelemetry implements DocsRetrievalTelemetryRecorder {
  readonly events: Parameters<DocsRetrievalTelemetryRecorder["recordRetrievalEvent"]>[0][] = [];

  async recordRetrievalEvent(input: Parameters<DocsRetrievalTelemetryRecorder["recordRetrievalEvent"]>[0]): Promise<void> {
    this.events.push(input);
  }
}

function makeHybrid(options: {
  readonly keywordResults?: readonly KeywordRetrievalResultItem[];
  readonly vectorResult?: VectorSearchResult;
  readonly telemetry?: DocsRetrievalTelemetryRecorder;
  readonly now?: Date;
  readonly freshnessMaxAgeMs?: number;
} = {}): HybridDocsRetrieval {
  return new HybridDocsRetrieval({
    keywordRetrieval: new StubKeywordRetrieval(options.keywordResults ?? []),
    vectorRetrieval: new StubVectorRetrieval(
      options.vectorResult ?? {
        ok: true,
        sourceId: "bun",
        query: "query",
        limit: 5,
        embedding: {
          provider: "fake",
          model: "fake",
          dimensions: 1536,
          embeddingVersion: "fake:v1"
        },
        results: []
      }
    ),
    telemetry: options.telemetry,
    now: () => options.now ?? freshNow,
    freshnessMaxAgeMs: options.freshnessMaxAgeMs ?? 7 * 24 * 60 * 60 * 1000,
    defaultLimit: 5,
    maxLimit: 20
  });
}

describe("hybrid docs retrieval", () => {
  test("hybrid merges keyword and semantic results", async () => {
    const retrieval = makeHybrid({
      keywordResults: [keywordItem()],
      vectorResult: {
        ok: true,
        sourceId: "bun",
        query: "background indexing",
        limit: 5,
        embedding: {
          provider: "fake",
          model: "fake",
          dimensions: 1536,
          embeddingVersion: "fake:v1"
        },
        results: [vectorItem()]
      }
    });

    const result = await retrieval.search({ sourceId: "bun", query: "background indexing", mode: "hybrid" });

    expect(result.results.map((item) => item.chunkId).sort((left, right) => left - right)).toEqual([1, 2]);
    expect(result.retrieval.keywordResultCount).toBe(1);
    expect(result.retrieval.vectorResultCount).toBe(1);
    expect(result.mode).toBe("hybrid");
  });

  test("duplicate chunks are returned once with combined scores", async () => {
    const retrieval = makeHybrid({
      keywordResults: [
        keywordItem({
          chunkId: 1,
          score: 1.4,
          keywordScore: 1.4,
          snippet: "Use Bun.serve to start an HTTP server."
        })
      ],
      vectorResult: {
        ok: true,
        sourceId: "bun",
        query: "start a web service",
        limit: 5,
        embedding: {
          provider: "fake",
          model: "fake",
          dimensions: 1536,
          embeddingVersion: "fake:v1"
        },
        results: [
          vectorItem({
            chunkId: 1,
            pageId: 10,
            title: "HTTP server",
            url: "https://bun.com/docs/runtime/http-server",
            vectorScore: 0.91,
            score: 0.91
          })
        ]
      }
    });

    const result = await retrieval.search({ sourceId: "bun", query: "start a web service", mode: "hybrid" });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      chunkId: 1,
      keywordScore: 1.4,
      vectorScore: 0.91
    });
    expect(result.results[0]?.score).toBeGreaterThan(1.4);
  });

  test("exact API match outranks semantically similar weak match", async () => {
    const retrieval = makeHybrid({
      keywordResults: [
        keywordItem({
          chunkId: 1,
          score: 0.2,
          keywordScore: 0.2,
          snippet: "Use Bun.serve to start an HTTP server."
        })
      ],
      vectorResult: {
        ok: true,
        sourceId: "bun",
        query: "Bun.serve",
        limit: 5,
        embedding: {
          provider: "fake",
          model: "fake",
          dimensions: 1536,
          embeddingVersion: "fake:v1"
        },
        results: [
          vectorItem({
            chunkId: 2,
            title: "Generic networking",
            snippet: "Create network services from JavaScript request handlers.",
            vectorScore: 0.99,
            score: 0.99
          })
        ]
      }
    });

    const result = await retrieval.search({ sourceId: "bun", query: "Bun.serve", mode: "hybrid" });

    expect(result.results[0]?.chunkId).toBe(1);
    expect(result.results[0]?.snippet).toContain("Bun.serve");
  });

  test("keyword mode does not call semantic retrieval", async () => {
    const vectorRetrieval = new ThrowingVectorRetrieval();
    const retrieval = new HybridDocsRetrieval({
      keywordRetrieval: new StubKeywordRetrieval([keywordItem()]),
      vectorRetrieval,
      now: () => freshNow,
      defaultLimit: 5,
      maxLimit: 20
    });

    const result = await retrieval.search({ sourceId: "bun", query: "Bun.serve", mode: "keyword" });

    expect(result.results).toHaveLength(1);
    expect(vectorRetrieval.calls).toHaveLength(0);
    expect(result.retrieval.vectorAttempted).toBe(false);
  });

  test("stale page lowers confidence", async () => {
    const retrieval = makeHybrid({
      keywordResults: [
        keywordItem({
          fetchedAt: "2026-04-01T00:00:00.000Z",
          indexedAt: "2026-04-01T00:00:00.000Z"
        })
      ],
      now: freshNow,
      freshnessMaxAgeMs: 7 * 24 * 60 * 60 * 1000
    });

    const result = await retrieval.search({ sourceId: "bun", query: "Bun.serve", mode: "keyword" });

    expect(result.freshness).toBe("stale");
    expect(result.confidence).toBe("medium");
    expect(result.warnings.map((warning) => warning.code)).toContain("stale_results");
  });

  test("empty result returns low confidence and warning", async () => {
    const retrieval = makeHybrid();

    const result = await retrieval.search({ sourceId: "bun", query: "no indexed evidence", mode: "hybrid" });

    expect(result.results).toEqual([]);
    expect(result.freshness).toBe("missing");
    expect(result.confidence).toBe("low");
    expect(result.warnings.map((warning) => warning.code)).toContain("no_results");
    expect(result.refreshReason).toBe("missing_content");
  });

  test("retrieval event stores query hash, not raw query", async () => {
    const telemetry = new CapturingTelemetry();
    const retrieval = makeHybrid({
      keywordResults: [keywordItem()],
      telemetry
    });

    await retrieval.search({ sourceId: "bun", query: "Bun.serve raw query", mode: "keyword" });

    expect(telemetry.events).toHaveLength(1);
    expect(telemetry.events[0]?.queryHash).toBe(hashRetrievalQuery("bun", "Bun.serve raw query"));
    expect(telemetry.events[0]?.queryHash).not.toBe("Bun.serve raw query");
    expect(telemetry.events[0]?.queryHash).toMatch(/^[a-f0-9]{64}$/);
    expect(telemetry.events[0]).toMatchObject({
      sourceId: "bun",
      mode: "keyword",
      resultCount: 1,
      confidence: "high",
      lowConfidence: false,
      refreshQueued: false
    });
  });

  test("semantic provider failure is surfaced as a warning with low confidence when no keyword evidence exists", async () => {
    const retrieval = makeHybrid({
      vectorResult: {
        ok: false,
        sourceId: "bun",
        query: "deployment",
        limit: 5,
        error: createStructuredError("fetch_failed", "Embedding provider request failed.", {
          provider: "fake"
        }),
        results: []
      }
    });

    const result = await retrieval.search({ sourceId: "bun", query: "deployment", mode: "semantic" });

    expect(result.results).toEqual([]);
    expect(result.confidence).toBe("low");
    expect(result.warnings.map((warning) => warning.code)).toContain("semantic_retrieval_failed");
  });
});
