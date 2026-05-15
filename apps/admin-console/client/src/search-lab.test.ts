import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import type { AdminSearchResponse } from "@bun-dev-intel/admin-contracts";
import {
  SearchResultsView,
  buildSearchRequest,
  type SearchLabFormState
} from "./search-lab";

describe("search lab", () => {
  test("search form submits contracted input", () => {
    const request = buildSearchRequest({
      query: "  Bun.serve routing  ",
      sourceId: "bun",
      mode: "hybrid",
      limit: 12,
      forceRefresh: true
    });

    expect(request).toEqual({
      query: "Bun.serve routing",
      sourceId: "bun",
      mode: "hybrid",
      limit: 12,
      forceRefresh: true
    });
  });

  test("mode selection changes request mode", () => {
    const base: SearchLabFormState = {
      query: "background refresh",
      sourceId: "",
      mode: "semantic",
      limit: 10,
      forceRefresh: false
    };

    expect(buildSearchRequest(base)).toEqual({
      query: "background refresh",
      mode: "semantic",
      limit: 10
    });
  });

  test("warnings render", () => {
    const html = renderResults(
      sampleSearchResponse({
        warnings: [{ code: "semantic_unavailable", message: "Vector search was unavailable." }]
      })
    );

    expect(html).toContain("semantic_unavailable");
    expect(html).toContain("Vector search was unavailable.");
  });

  test("page and chunk links are generated", () => {
    const html = renderResults(sampleSearchResponse());

    expect(html).toContain("href=\"/sources/bun/pages/10\"");
    expect(html).toContain("href=\"/sources/bun/chunks/20\"");
    expect(html).toContain("0.940");
    expect(html).toContain("0.500");
  });

  test("zero-result state renders", () => {
    const html = renderResults(
      sampleSearchResponse({
        confidence: "low",
        results: [],
        retrieval: {
          mode: "hybrid",
          keywordAttempted: true,
          vectorAttempted: true,
          keywordResultCount: 0,
          vectorResultCount: 0,
          mergedResultCount: 0,
          queryHash: "query-hash"
        }
      })
    );

    expect(html).toContain("No results for this query");
    expect(html).toContain("Low-confidence retrieval");
  });
});

function renderResults(response: AdminSearchResponse): string {
  return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(SearchResultsView, { response })));
}

function sampleSearchResponse(overrides: Partial<AdminSearchResponse> = {}): AdminSearchResponse {
  return {
    ok: true,
    generatedAt: "2026-05-15T12:00:00.000Z",
    query: "Bun.serve routing",
    sourceId: "bun",
    mode: "hybrid",
    limit: 10,
    results: [
      {
        chunkId: 20,
        pageId: 10,
        title: "Bun.serve",
        url: "https://bun.com/docs/api/http",
        headingPath: ["API", "HTTP"],
        snippet: "Bun.serve starts an HTTP server and routes requests.",
        score: 0.94,
        keywordScore: 0.5,
        vectorScore: 0.88,
        rerankScore: 0.91,
        fetchedAt: "2026-05-15T10:00:00.000Z",
        indexedAt: "2026-05-15T11:00:00.000Z",
        contentHash: "chunk-hash"
      }
    ],
    sources: [
      {
        title: "Bun HTTP docs",
        url: "https://bun.com/docs/api/http",
        sourceType: "official-docs",
        fetchedAt: "2026-05-15T10:00:00.000Z",
        contentHash: "chunk-hash"
      }
    ],
    freshness: "fresh",
    confidence: "high",
    refreshQueued: false,
    retrieval: {
      mode: "hybrid",
      keywordAttempted: true,
      vectorAttempted: true,
      keywordResultCount: 1,
      vectorResultCount: 1,
      mergedResultCount: 1,
      queryHash: "query-hash"
    },
    warnings: [],
    ...overrides
  };
}
