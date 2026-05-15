import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AdminJobSummary, AdminOverviewKpis, AdminSourceHealth } from "@bun-dev-intel/admin-contracts";
import { AdminApiClient } from "./api-client";
import {
  EmbeddingCoverageChart,
  KpiWindowSelector,
  OverviewDashboardView,
  adminOverviewQueryKey,
  buildEmbeddingCoverageData,
  buildFailedJobsByTypeData,
  buildJobStatusTimelineData,
  buildOverviewKpiCards
} from "./overview";

describe("overview dashboard", () => {
  test("window selector marks the selected window and the API client requests that window", async () => {
    const html = renderToStaticMarkup(
      createElement(KpiWindowSelector, {
        selectedWindow: "7d",
        onWindowChange: () => undefined
      })
    );
    const requestedUrls: string[] = [];
    const client = new AdminApiClient({
      fetchImpl: (async (url: string | URL | Request) => {
        requestedUrls.push(String(url));

        return new Response(JSON.stringify({ ok: true, overview: sampleOverview({ window: "7d" }) }), {
          headers: { "content-type": "application/json" }
        });
      }) as typeof fetch
    });

    await client.getOverview("7d");

    expect(html).toContain("aria-pressed=\"true\">7d");
    expect(adminOverviewQueryKey("7d")).toEqual(["admin", "overview", "7d"]);
    expect(requestedUrls).toEqual(["/api/admin/overview?window=7d"]);
  });

  test("unavailable KPI is labeled instead of hidden", () => {
    const cards = buildOverviewKpiCards(sampleOverview());
    const staleResultRate = cards.find((card) => card.label === "Stale-result rate");

    expect(staleResultRate).toEqual({
      label: "Stale-result rate",
      value: "Unavailable",
      detail: "doc_retrieval_events does not yet store result freshness telemetry.",
      tone: "unavailable"
    });
  });

  test("chart renders seeded data with an accessible summary", () => {
    const data = buildEmbeddingCoverageData([
      sampleSource({
        displayName: "Bun Docs",
        chunkCount: 12,
        embeddingCoverage: 0.75
      })
    ]);
    const html = renderToStaticMarkup(createElement(EmbeddingCoverageChart, { data }));

    expect(html).toContain("Embedding coverage by source");
    expect(html).toContain("Bun Docs");
    expect(html).toContain("75% of 12 chunks");
  });

  test("empty state renders when no overview data exists", () => {
    const html = renderToStaticMarkup(
      createElement(OverviewDashboardView, {
        overview: sampleOverview({
          totalSources: 0,
          enabledSources: 0,
          totalPages: 0,
          totalChunks: 0,
          totalEmbeddings: 0,
          embeddedChunkCount: 0,
          embeddingCoverage: null,
          stalePages: 0,
          tombstonedPages: 0,
          queuedJobs: 0,
          runningJobs: 0,
          failedJobs: 0,
          searches: 0,
          zeroResultCount: 0,
          zeroResultRate: null,
          lowConfidenceCount: 0,
          lowConfidenceRate: null,
          refreshQueuedCount: 0
        }),
        sources: [],
        jobs: []
      })
    );

    expect(html).toContain("No indexed data yet");
    expect(html).toContain("No searches recorded in this window.");
    expect(html).toContain("No embedding coverage data is available.");
  });

  test("job chart helpers build status timeline and failed-type data", () => {
    const overview = sampleOverview();
    const jobs = [
      sampleJob({ id: 1, status: "failed", jobType: "embedding", updatedAt: "2026-05-13T13:00:00.000Z" }),
      sampleJob({ id: 2, status: "queued", jobType: "page", updatedAt: "2026-05-13T14:00:00.000Z" })
    ];

    const timeline = buildJobStatusTimelineData(jobs, overview);
    const failedTypes = buildFailedJobsByTypeData(jobs);

    expect(timeline.reduce((count, bucket) => count + bucket.failed, 0)).toBe(1);
    expect(timeline.reduce((count, bucket) => count + bucket.queued, 0)).toBe(1);
    expect(failedTypes).toEqual([{ label: "Embedding", failed: 1 }]);
  });
});

function sampleOverview(overrides: Partial<AdminOverviewKpis> = {}): AdminOverviewKpis {
  return {
    window: "24h",
    windowStartedAt: "2026-05-13T12:00:00.000Z",
    generatedAt: "2026-05-14T12:00:00.000Z",
    totalSources: 2,
    enabledSources: 1,
    totalPages: 18,
    totalChunks: 64,
    totalEmbeddings: 52,
    embeddedChunkCount: 52,
    embeddingCoverage: 0.8125,
    stalePages: 3,
    tombstonedPages: 1,
    queuedJobs: 2,
    runningJobs: 1,
    failedJobs: 1,
    searches: 9,
    zeroResultCount: 2,
    zeroResultRate: 2 / 9,
    lowConfidenceCount: 1,
    lowConfidenceRate: 1 / 9,
    refreshQueuedCount: 3,
    staleResultRate: {
      available: false,
      value: null,
      reason: "doc_retrieval_events does not yet store result freshness telemetry."
    },
    ...overrides
  };
}

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
    oldestFetchedPage: "2026-05-13T12:00:00.000Z",
    newestIndexedPage: "2026-05-14T12:00:00.000Z",
    latestSuccessfulJob: null,
    latestFailedJob: null,
    ...overrides
  };
}

function sampleJob(overrides: Partial<AdminJobSummary> = {}): AdminJobSummary {
  return {
    id: 1,
    sourceId: "bun",
    url: "https://bun.com/docs/runtime",
    jobType: "page",
    reason: "scheduled",
    status: "queued",
    priority: 0,
    attemptCount: 0,
    lastError: null,
    runAfter: "2026-05-13T12:00:00.000Z",
    startedAt: null,
    finishedAt: null,
    createdAt: "2026-05-13T12:00:00.000Z",
    updatedAt: "2026-05-13T12:00:00.000Z",
    ...overrides
  };
}
