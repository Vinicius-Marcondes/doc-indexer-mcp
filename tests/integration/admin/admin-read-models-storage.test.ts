import { afterEach, describe, expect, test } from "bun:test";
import { AdminReadModelStorage } from "../../../apps/admin-console/server/src/read-models";
import {
  createRemoteDocsTestDatabase,
  type RemoteDocsTestDatabase
} from "../storage/test-harness";

const postgresTest = process.env.TEST_DATABASE_URL === undefined ? test.skip : test;
let database: RemoteDocsTestDatabase | null = null;

afterEach(async () => {
  await database?.cleanup();
  database = null;
});

function vector1536(firstValue = 0.1): string {
  return `[${Array.from({ length: 1536 }, (_, index) => (index === 0 ? firstValue : 0)).join(",")}]`;
}

async function setupDatabase(): Promise<RemoteDocsTestDatabase> {
  database = await createRemoteDocsTestDatabase();

  if (database === null) {
    throw new Error("Expected TEST_DATABASE_URL database.");
  }

  return database;
}

async function seedSource(input: {
  readonly sourceId: string;
  readonly displayName?: string;
  readonly enabled?: boolean;
  readonly defaultTtlSeconds?: number;
}): Promise<void> {
  if (database === null) {
    throw new Error("Expected test database.");
  }

  await database.sql`
    insert into doc_sources (source_id, display_name, enabled, allowed_url_patterns, default_ttl_seconds)
    values (
      ${input.sourceId},
      ${input.displayName ?? `${input.sourceId} docs`},
      ${input.enabled ?? true},
      to_jsonb(${[`https://example.com/${input.sourceId}/*`]}::text[]),
      ${input.defaultTtlSeconds ?? 3600}
    )
  `;
}

async function seedPage(input: {
  readonly sourceId: string;
  readonly slug: string;
  readonly title: string;
  readonly fetchedAt: string;
  readonly indexedAt: string;
  readonly expiresAt?: string | null;
  readonly tombstonedAt?: string | null;
  readonly tombstoneReason?: string | null;
}): Promise<number> {
  if (database === null) {
    throw new Error("Expected test database.");
  }

  const url = `https://example.com/${input.sourceId}/${input.slug}`;
  const rows = await database.sql<Array<{ id: number }>>`
    insert into doc_pages (
      source_id,
      url,
      canonical_url,
      title,
      content,
      content_hash,
      http_status,
      fetched_at,
      indexed_at,
      expires_at,
      tombstoned_at,
      tombstone_reason
    )
    values (
      ${input.sourceId},
      ${url},
      ${url},
      ${input.title},
      ${`${input.title} content`},
      ${`${input.slug}-hash`},
      200,
      ${input.fetchedAt},
      ${input.indexedAt},
      ${input.expiresAt ?? null},
      ${input.tombstonedAt ?? null},
      ${input.tombstoneReason ?? null}
    )
    returning id
  `;
  const row = rows[0];

  if (row === undefined) {
    throw new Error("Expected inserted page.");
  }

  return Number(row.id);
}

async function seedChunk(input: {
  readonly sourceId: string;
  readonly pageId: number;
  readonly slug: string;
  readonly chunkIndex: number;
  readonly headingPath: readonly string[];
}): Promise<number> {
  if (database === null) {
    throw new Error("Expected test database.");
  }

  const url = `https://example.com/${input.sourceId}/${input.slug}`;
  const rows = await database.sql<Array<{ id: number }>>`
    insert into doc_chunks (
      source_id,
      page_id,
      url,
      title,
      heading_path,
      chunk_index,
      content,
      content_hash,
      token_estimate
    )
    values (
      ${input.sourceId},
      ${input.pageId},
      ${url},
      ${input.headingPath.at(-1) ?? "Chunk"},
      ${input.headingPath}::text[],
      ${input.chunkIndex},
      ${`${input.headingPath.join(" ")} content`},
      ${`${input.slug}-chunk-${input.chunkIndex}`},
      8
    )
    returning id
  `;
  const row = rows[0];

  if (row === undefined) {
    throw new Error("Expected inserted chunk.");
  }

  return Number(row.id);
}

async function seedEmbedding(chunkId: number, firstValue = 0.1): Promise<void> {
  if (database === null) {
    throw new Error("Expected test database.");
  }

  await database.sql`
    insert into doc_embeddings (chunk_id, provider, model, embedding_version, dimensions, embedding)
    values (${chunkId}, 'openai', 'text-embedding-3-small', 'v1', 1536, ${vector1536(firstValue)}::vector)
  `;
}

async function seedJob(input: {
  readonly sourceId: string;
  readonly url?: string | null;
  readonly jobType?: string;
  readonly reason?: string;
  readonly status: string;
  readonly createdAt: string;
  readonly updatedAt?: string;
  readonly startedAt?: string | null;
  readonly finishedAt?: string | null;
  readonly lastError?: string | null;
}): Promise<number> {
  if (database === null) {
    throw new Error("Expected test database.");
  }

  const rows = await database.sql<Array<{ id: number }>>`
    insert into doc_refresh_jobs (
      source_id,
      url,
      job_type,
      reason,
      status,
      priority,
      attempt_count,
      last_error,
      run_after,
      started_at,
      finished_at,
      created_at,
      updated_at
    )
    values (
      ${input.sourceId},
      ${input.url ?? null},
      ${input.jobType ?? "page"},
      ${input.reason ?? "manual"},
      ${input.status},
      10,
      1,
      ${input.lastError ?? null},
      ${input.createdAt},
      ${input.startedAt ?? null},
      ${input.finishedAt ?? null},
      ${input.createdAt},
      ${input.updatedAt ?? input.finishedAt ?? input.createdAt}
    )
    returning id
  `;
  const row = rows[0];

  if (row === undefined) {
    throw new Error("Expected inserted job.");
  }

  return Number(row.id);
}

async function seedRetrievalEvent(input: {
  readonly sourceId: string;
  readonly queryHash: string;
  readonly resultCount: number;
  readonly confidence: "high" | "medium" | "low";
  readonly lowConfidence: boolean;
  readonly refreshQueued: boolean;
  readonly createdAt: string;
}): Promise<void> {
  if (database === null) {
    throw new Error("Expected test database.");
  }

  await database.sql`
    insert into doc_retrieval_events (
      source_id,
      query_hash,
      mode,
      result_count,
      confidence,
      low_confidence,
      refresh_queued,
      created_at
    )
    values (
      ${input.sourceId},
      ${input.queryHash},
      'hybrid',
      ${input.resultCount},
      ${input.confidence},
      ${input.lowConfidence},
      ${input.refreshQueued},
      ${input.createdAt}
    )
  `;
}

describe("admin read model storage", () => {
  postgresTest("source health reports freshness, tombstones, embedding coverage, and latest jobs", async () => {
    const testDb = await setupDatabase();
    const storage = new AdminReadModelStorage(testDb.sql);
    const now = "2026-05-14T12:00:00.000Z";

    await seedSource({ sourceId: "bun", displayName: "Bun docs", defaultTtlSeconds: 3600 });
    const freshPage = await seedPage({
      sourceId: "bun",
      slug: "fresh",
      title: "Fresh page",
      fetchedAt: "2026-05-10T12:00:00.000Z",
      indexedAt: "2026-05-14T09:00:00.000Z",
      expiresAt: "2026-05-14T13:00:00.000Z"
    });
    const stalePage = await seedPage({
      sourceId: "bun",
      slug: "stale",
      title: "Stale page",
      fetchedAt: "2026-05-11T12:00:00.000Z",
      indexedAt: "2026-05-14T10:00:00.000Z",
      expiresAt: "2026-05-14T11:30:00.000Z"
    });
    const tombstonedPage = await seedPage({
      sourceId: "bun",
      slug: "removed",
      title: "Removed page",
      fetchedAt: "2026-05-12T12:00:00.000Z",
      indexedAt: "2026-05-14T08:00:00.000Z",
      expiresAt: "2026-05-14T13:00:00.000Z",
      tombstonedAt: "2026-05-14T11:00:00.000Z",
      tombstoneReason: "gone"
    });
    const firstChunk = await seedChunk({ sourceId: "bun", pageId: freshPage, slug: "fresh", chunkIndex: 0, headingPath: ["Fresh"] });
    await seedChunk({ sourceId: "bun", pageId: freshPage, slug: "fresh", chunkIndex: 1, headingPath: ["Fresh", "API"] });
    const staleChunk = await seedChunk({ sourceId: "bun", pageId: stalePage, slug: "stale", chunkIndex: 0, headingPath: ["Stale"] });
    const tombstonedChunk = await seedChunk({
      sourceId: "bun",
      pageId: tombstonedPage,
      slug: "removed",
      chunkIndex: 0,
      headingPath: ["Removed"]
    });

    await seedEmbedding(firstChunk, 0.1);
    await seedEmbedding(staleChunk, 0.2);
    await seedEmbedding(tombstonedChunk, 0.3);
    await seedJob({
      sourceId: "bun",
      status: "succeeded",
      createdAt: "2026-05-14T10:00:00.000Z",
      finishedAt: "2026-05-14T10:01:00.000Z"
    });
    await seedJob({
      sourceId: "bun",
      status: "failed",
      createdAt: "2026-05-14T11:00:00.000Z",
      finishedAt: "2026-05-14T11:01:00.000Z",
      lastError: "network"
    });

    const health = await storage.getSourceHealth({ sourceId: "bun", now });
    const sources = await storage.listSourceHealth(now);

    expect(sources.map((source) => source.sourceId)).toEqual(["bun"]);
    expect(health?.pageCount).toBe(2);
    expect(health?.chunkCount).toBe(3);
    expect(health?.embeddingCount).toBe(2);
    expect(health?.embeddedChunkCount).toBe(2);
    expect(health?.embeddingCoverage).toBe(2 / 3);
    expect(health?.stalePages).toBe(1);
    expect(health?.tombstonedPages).toBe(1);
    expect(health?.oldestFetchedPage).toBe("2026-05-10T12:00:00.000Z");
    expect(health?.newestIndexedPage).toBe("2026-05-14T10:00:00.000Z");
    expect(health?.latestSuccessfulJob?.status).toBe("succeeded");
    expect(health?.latestFailedJob?.lastError).toBe("network");
  });

  postgresTest("overview KPIs count current index state and retrieval rates inside the selected window", async () => {
    const testDb = await setupDatabase();
    const storage = new AdminReadModelStorage(testDb.sql);
    const now = "2026-05-14T12:00:00.000Z";

    await seedSource({ sourceId: "bun", displayName: "Bun docs", defaultTtlSeconds: 3600 });
    const freshPage = await seedPage({
      sourceId: "bun",
      slug: "fresh",
      title: "Fresh page",
      fetchedAt: "2026-05-14T09:00:00.000Z",
      indexedAt: "2026-05-14T09:30:00.000Z",
      expiresAt: "2026-05-14T13:00:00.000Z"
    });
    const stalePage = await seedPage({
      sourceId: "bun",
      slug: "stale",
      title: "Stale page",
      fetchedAt: "2026-05-14T08:00:00.000Z",
      indexedAt: "2026-05-14T08:30:00.000Z",
      expiresAt: "2026-05-14T11:30:00.000Z"
    });
    await seedPage({
      sourceId: "bun",
      slug: "removed",
      title: "Removed page",
      fetchedAt: "2026-05-14T07:00:00.000Z",
      indexedAt: "2026-05-14T07:30:00.000Z",
      tombstonedAt: "2026-05-14T11:00:00.000Z",
      tombstoneReason: "removed"
    });
    const firstChunk = await seedChunk({ sourceId: "bun", pageId: freshPage, slug: "fresh", chunkIndex: 0, headingPath: ["Fresh"] });
    await seedChunk({ sourceId: "bun", pageId: stalePage, slug: "stale", chunkIndex: 0, headingPath: ["Stale"] });
    await seedEmbedding(firstChunk, 0.1);
    await seedJob({ sourceId: "bun", url: "https://example.com/bun/fresh", jobType: "page", status: "queued", createdAt: now });
    await seedJob({ sourceId: "bun", url: "https://example.com/bun/stale", jobType: "embedding", status: "running", createdAt: now });
    await seedJob({
      sourceId: "bun",
      url: "https://example.com/bun/failed",
      jobType: "page",
      status: "failed",
      createdAt: "2026-05-14T11:00:00.000Z",
      finishedAt: "2026-05-14T11:01:00.000Z"
    });
    await seedJob({
      sourceId: "bun",
      url: "https://example.com/bun/old-failed",
      jobType: "tombstone_check",
      status: "failed",
      createdAt: "2026-05-12T11:00:00.000Z",
      finishedAt: "2026-05-12T11:01:00.000Z"
    });
    await seedRetrievalEvent({
      sourceId: "bun",
      queryHash: "zero",
      resultCount: 0,
      confidence: "low",
      lowConfidence: true,
      refreshQueued: true,
      createdAt: "2026-05-14T11:00:00.000Z"
    });
    await seedRetrievalEvent({
      sourceId: "bun",
      queryHash: "good",
      resultCount: 3,
      confidence: "high",
      lowConfidence: false,
      refreshQueued: false,
      createdAt: "2026-05-14T10:00:00.000Z"
    });
    await seedRetrievalEvent({
      sourceId: "bun",
      queryHash: "medium",
      resultCount: 1,
      confidence: "medium",
      lowConfidence: false,
      refreshQueued: false,
      createdAt: "2026-05-13T12:30:00.000Z"
    });
    await seedRetrievalEvent({
      sourceId: "bun",
      queryHash: "old",
      resultCount: 0,
      confidence: "low",
      lowConfidence: true,
      refreshQueued: true,
      createdAt: "2026-05-13T11:30:00.000Z"
    });

    const overview = await storage.getOverview({ window: "24h", now });

    expect(overview.windowStartedAt).toBe("2026-05-13T12:00:00.000Z");
    expect(overview.totalSources).toBe(1);
    expect(overview.enabledSources).toBe(1);
    expect(overview.totalPages).toBe(2);
    expect(overview.totalChunks).toBe(2);
    expect(overview.totalEmbeddings).toBe(1);
    expect(overview.embeddingCoverage).toBe(0.5);
    expect(overview.stalePages).toBe(1);
    expect(overview.tombstonedPages).toBe(1);
    expect(overview.queuedJobs).toBe(1);
    expect(overview.runningJobs).toBe(1);
    expect(overview.failedJobs).toBe(1);
    expect(overview.searches).toBe(3);
    expect(overview.zeroResultRate).toBe(1 / 3);
    expect(overview.lowConfidenceRate).toBe(1 / 3);
    expect(overview.refreshQueuedCount).toBe(1);
    expect(overview.staleResultRate.available).toBe(false);
  });

  postgresTest("page, chunk, job, and audit reads use bounded operational views", async () => {
    const testDb = await setupDatabase();
    const storage = new AdminReadModelStorage(testDb.sql);
    const now = "2026-05-14T12:00:00.000Z";

    await seedSource({ sourceId: "bun", displayName: "Bun docs", defaultTtlSeconds: 3600 });
    const freshPage = await seedPage({
      sourceId: "bun",
      slug: "fresh",
      title: "Fresh page",
      fetchedAt: "2026-05-14T09:00:00.000Z",
      indexedAt: "2026-05-14T09:30:00.000Z",
      expiresAt: "2026-05-14T13:00:00.000Z"
    });
    const expiredPage = await seedPage({
      sourceId: "bun",
      slug: "expired",
      title: "Expired page",
      fetchedAt: "2026-05-14T07:00:00.000Z",
      indexedAt: "2026-05-14T07:30:00.000Z",
      expiresAt: "2026-05-14T10:00:00.000Z"
    });
    const firstChunk = await seedChunk({ sourceId: "bun", pageId: freshPage, slug: "fresh", chunkIndex: 0, headingPath: ["Fresh"] });
    const secondChunk = await seedChunk({ sourceId: "bun", pageId: freshPage, slug: "fresh", chunkIndex: 1, headingPath: ["Fresh", "Install"] });
    await seedChunk({ sourceId: "bun", pageId: expiredPage, slug: "expired", chunkIndex: 0, headingPath: ["Expired"] });
    await seedEmbedding(firstChunk, 0.1);
    const failedJob = await seedJob({
      sourceId: "bun",
      url: "https://example.com/bun/fresh",
      jobType: "page",
      status: "failed",
      createdAt: "2026-05-14T11:00:00.000Z",
      finishedAt: "2026-05-14T11:01:00.000Z",
      lastError: "boom"
    });
    await seedJob({
      sourceId: "bun",
      url: "https://example.com/bun/expired",
      jobType: "page",
      status: "succeeded",
      createdAt: "2026-05-13T10:00:00.000Z",
      finishedAt: "2026-05-13T10:01:00.000Z"
    });
    await testDb.sql`
      insert into admin_audit_events (event_type, target_type, target_id, details, created_at)
      values ('admin.source.refresh', 'source', 'bun', '{"status":"queued"}'::jsonb, ${now})
    `;

    const pages = await storage.listPages({ sourceId: "bun", freshness: "expired", hasEmbedding: false, limit: 500, now });
    const pageDetail = await storage.getPageDetail({ sourceId: "bun", pageId: freshPage, now });
    const chunkDetail = await storage.getChunkDetail({ sourceId: "bun", chunkId: secondChunk });
    const failedJobs = await storage.listJobs({
      sourceId: "bun",
      status: "failed",
      urlContains: "fresh",
      window: "24h",
      now,
      limit: 10
    });
    const jobDetail = await storage.getJobDetail(failedJob);
    const audit = await storage.listAuditEvents();

    expect(pages.items).toHaveLength(1);
    expect(pages.items[0]?.id).toBe(expiredPage);
    expect(pages.nextCursor).toBeNull();
    expect(pageDetail?.chunks.map((chunk) => chunk.chunkIndex)).toEqual([0, 1]);
    expect(pageDetail?.embeddingCount).toBe(1);
    expect(chunkDetail?.previousChunkId).toBe(firstChunk);
    expect(chunkDetail?.nextChunkId).toBeNull();
    expect(failedJobs.items.map((job) => job.id)).toEqual([failedJob]);
    expect(jobDetail?.lastError).toBe("boom");
    expect(audit.available).toBe(true);
    expect(audit.available ? audit.items[0] : undefined).toMatchObject({
      eventType: "admin.source.refresh",
      targetType: "source",
      targetId: "bun",
      details: {
        status: "queued"
      }
    });
  });
});
