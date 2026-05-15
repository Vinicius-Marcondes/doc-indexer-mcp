import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import type { AdminChunkDetail, AdminJobSummary, AdminPageListItem, AdminSourceHealth } from "@bun-dev-intel/admin-contracts";
import { AdminApiClient } from "./api-client";
import {
  ChunkDetailView,
  JobDetailView,
  SourcesTable,
  sanitizeJobError
} from "./resource-views";

describe("resource and job views", () => {
  test("sources table renders source health stats", () => {
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(SourcesTable, {
          sources: [
            sampleSource({
              displayName: "Bun Docs",
              pageCount: 12,
              chunkCount: 42,
              embeddingCoverage: 0.875,
              stalePages: 2
            })
          ]
        })
      )
    );

    expect(html).toContain("Bun Docs");
    expect(html).toContain("12");
    expect(html).toContain("42");
    expect(html).toContain("87.5%");
    expect(html).toContain("enabled");
  });

  test("page filters update the API query", async () => {
    const requestedUrls: string[] = [];
    const client = new AdminApiClient({
      fetchImpl: (async (url: string | URL | Request) => {
        requestedUrls.push(String(url));
        return new Response(JSON.stringify({ ok: true, pages: [samplePage()], nextCursor: 7 }), {
          headers: { "content-type": "application/json" }
        });
      }) as typeof fetch
    });

    await client.listPages({
      sourceId: "bun",
      q: "serve",
      freshness: "stale",
      hasEmbedding: true,
      limit: 25,
      cursor: 10
    });

    expect(requestedUrls).toEqual(["/api/admin/sources/bun/pages?q=serve&freshness=stale&hasEmbedding=true&limit=25&cursor=10"]);
  });

  test("chunk detail renders heading path", () => {
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(ChunkDetailView, {
          chunk: sampleChunk({
            headingPath: ["Runtime", "HTTP"],
            content: "Bun.serve starts an HTTP server."
          })
        })
      )
    );

    expect(html).toContain("Runtime / HTTP");
    expect(html).toContain("Bun.serve starts an HTTP server.");
  });

  test("jobs filters update the API query", async () => {
    const requestedUrls: string[] = [];
    const client = new AdminApiClient({
      fetchImpl: (async (url: string | URL | Request) => {
        requestedUrls.push(String(url));
        return new Response(JSON.stringify({ ok: true, jobs: [sampleJob()], nextCursor: null }), {
          headers: { "content-type": "application/json" }
        });
      }) as typeof fetch
    });

    await client.listJobs({
      sourceId: "bun",
      status: "failed",
      jobType: "embedding",
      reason: "manual",
      urlContains: "runtime",
      window: "7d",
      limit: 50,
      cursor: 9
    });

    expect(requestedUrls).toEqual([
      "/api/admin/jobs?sourceId=bun&status=failed&jobType=embedding&reason=manual&urlContains=runtime&window=7d&limit=50&cursor=9"
    ]);
  });

  test("sanitized job error is rendered without secret-like strings", () => {
    const rawError = "Embedding failed with Bearer sk-testSecret123456 token=abc123 password=hunter2 API_KEY=xyz789";
    const sanitized = sanitizeJobError(rawError);
    const html = renderToStaticMarkup(createElement(JobDetailView, { job: sampleJob({ status: "failed", lastError: rawError }) }));

    expect(sanitized).not.toContain("sk-testSecret123456");
    expect(sanitized).not.toContain("abc123");
    expect(sanitized).not.toContain("hunter2");
    expect(sanitized).not.toContain("xyz789");
    expect(html).toContain("[redacted]");
    expect(html).not.toContain("sk-testSecret123456");
    expect(html).not.toContain("hunter2");
  });
});

function sampleSource(overrides: Partial<AdminSourceHealth> = {}): AdminSourceHealth {
  return {
    sourceId: "bun",
    displayName: "Bun",
    enabled: true,
    allowedUrlPatterns: ["https://bun.com/docs/**"],
    defaultTtlSeconds: 86400,
    pageCount: 3,
    chunkCount: 10,
    embeddingCount: 8,
    embeddedChunkCount: 8,
    embeddingCoverage: 0.8,
    stalePages: 1,
    tombstonedPages: 0,
    oldestFetchedPage: "2026-05-14T12:00:00.000Z",
    newestIndexedPage: "2026-05-15T12:00:00.000Z",
    latestSuccessfulJob: null,
    latestFailedJob: null,
    ...overrides
  };
}

function samplePage(overrides: Partial<AdminPageListItem> = {}): AdminPageListItem {
  return {
    id: 10,
    sourceId: "bun",
    url: "https://bun.com/docs/runtime",
    canonicalUrl: "https://bun.com/docs/runtime",
    title: "Runtime",
    httpStatus: 200,
    contentHash: "hash-page",
    freshness: "fresh",
    fetchedAt: "2026-05-14T12:00:00.000Z",
    indexedAt: "2026-05-15T12:00:00.000Z",
    expiresAt: null,
    tombstonedAt: null,
    tombstoneReason: null,
    chunkCount: 2,
    embeddingCount: 2,
    hasEmbedding: true,
    ...overrides
  };
}

function sampleChunk(overrides: Partial<AdminChunkDetail> = {}): AdminChunkDetail {
  return {
    id: 20,
    sourceId: "bun",
    pageId: 10,
    pageTitle: "Runtime",
    pageUrl: "https://bun.com/docs/runtime",
    pageCanonicalUrl: "https://bun.com/docs/runtime",
    pageTombstonedAt: null,
    title: "HTTP",
    headingPath: ["Runtime"],
    chunkIndex: 1,
    content: "Chunk content",
    contentHash: "hash-chunk",
    tokenEstimate: 18,
    embeddingCount: 1,
    hasEmbedding: true,
    previousChunkId: null,
    nextChunkId: 21,
    createdAt: "2026-05-14T12:00:00.000Z",
    updatedAt: "2026-05-15T12:00:00.000Z",
    ...overrides
  };
}

function sampleJob(overrides: Partial<AdminJobSummary> = {}): AdminJobSummary {
  return {
    id: 7,
    sourceId: "bun",
    url: "https://bun.com/docs/runtime",
    jobType: "embedding",
    reason: "manual",
    status: "failed",
    priority: 0,
    attemptCount: 2,
    lastError: "timeout",
    runAfter: "2026-05-15T10:00:00.000Z",
    startedAt: "2026-05-15T10:01:00.000Z",
    finishedAt: "2026-05-15T10:02:00.000Z",
    createdAt: "2026-05-15T10:00:00.000Z",
    updatedAt: "2026-05-15T10:02:00.000Z",
    ...overrides
  };
}
