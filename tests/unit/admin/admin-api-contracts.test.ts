import { describe, expect, test } from "bun:test";
import {
  adminAuditEventsResponseSchema,
  adminAuthUserResponseSchema,
  adminOverviewResponseSchema,
  adminPagesResponseSchema,
  adminSearchRequestSchema,
  adminSearchResponseSchema
} from "../../../packages/admin-contracts/src";

function sampleOverview() {
  return {
    window: "24h",
    windowStartedAt: "2026-05-13T12:00:00.000Z",
    generatedAt: "2026-05-14T12:00:00.000Z",
    totalSources: 1,
    enabledSources: 1,
    totalPages: 2,
    totalChunks: 3,
    totalEmbeddings: 2,
    embeddedChunkCount: 2,
    embeddingCoverage: 2 / 3,
    stalePages: 1,
    tombstonedPages: 0,
    queuedJobs: 1,
    runningJobs: 0,
    failedJobs: 1,
    searches: 3,
    zeroResultCount: 1,
    zeroResultRate: 1 / 3,
    lowConfidenceCount: 1,
    lowConfidenceRate: 1 / 3,
    refreshQueuedCount: 1,
    staleResultRate: {
      available: false,
      value: null,
      reason: "freshness telemetry unavailable"
    }
  };
}

describe("admin API contracts", () => {
  test("auth user response parses stable admin and viewer roles", () => {
    expect(
      adminAuthUserResponseSchema.parse({
        ok: true,
        user: {
          id: 1,
          email: "admin@example.com",
          role: "admin"
        }
      }).user.role
    ).toBe("admin");
  });

  test("overview response parses dashboard KPI payload", () => {
    const parsed = adminOverviewResponseSchema.parse({
      ok: true,
      overview: sampleOverview()
    });

    expect(parsed.overview.embeddingCoverage).toBe(2 / 3);
  });

  test("page list response parses pagination and freshness fields", () => {
    const parsed = adminPagesResponseSchema.parse({
      ok: true,
      pages: [
        {
          id: 10,
          sourceId: "bun",
          url: "https://bun.com/docs/runtime",
          canonicalUrl: "https://bun.com/docs/runtime",
          title: "Runtime",
          httpStatus: 200,
          contentHash: "hash",
          freshness: "fresh",
          fetchedAt: "2026-05-14T12:00:00.000Z",
          indexedAt: "2026-05-14T12:00:00.000Z",
          expiresAt: null,
          tombstonedAt: null,
          tombstoneReason: null,
          chunkCount: 2,
          embeddingCount: 1,
          hasEmbedding: true
        }
      ],
      nextCursor: null
    });

    expect(parsed.pages[0]?.freshness).toBe("fresh");
  });

  test("search request and response parse the UI-oriented retrieval payload", () => {
    expect(adminSearchRequestSchema.parse({ query: "Bun.serve", sourceId: "bun", mode: "hybrid", limit: 5 }).mode).toBe("hybrid");

    const parsed = adminSearchResponseSchema.parse({
      ok: true,
      generatedAt: "2026-05-14T12:00:00.000Z",
      query: "Bun.serve",
      sourceId: "bun",
      mode: "hybrid",
      limit: 5,
      results: [
        {
          chunkId: 1,
          pageId: 2,
          title: "Runtime",
          url: "https://bun.com/docs/runtime",
          headingPath: ["Runtime"],
          snippet: "Use Bun.serve",
          score: 2.5,
          keywordScore: 1,
          vectorScore: 0.5,
          rerankScore: 1,
          fetchedAt: "2026-05-14T12:00:00.000Z",
          indexedAt: "2026-05-14T12:00:00.000Z",
          contentHash: "hash"
        }
      ],
      sources: [
        {
          title: "Runtime",
          url: "https://bun.com/docs/runtime",
          sourceType: "bun-docs",
          fetchedAt: "2026-05-14T12:00:00.000Z",
          contentHash: "hash"
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
      warnings: []
    });

    expect(parsed.results[0]?.chunkId).toBe(1);
  });

  test("audit response supports unavailable audit storage", () => {
    const parsed = adminAuditEventsResponseSchema.parse({
      ok: true,
      audit: {
        available: false,
        items: [],
        nextCursor: null,
        reason: "admin_audit_events table is not available yet."
      }
    });

    expect(parsed.audit.available).toBe(false);
  });
});

