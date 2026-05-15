import { describe, expect, test } from "bun:test";
import {
  adminErrorResponseSchema,
  adminOverviewResponseSchema,
  adminSearchResponseSchema
} from "../../../packages/admin-contracts/src";
import {
  createAdminApiRoutes,
  type AdminApiAuthStore,
  type AdminReadModels,
  type AdminSearchService
} from "../../../apps/admin-console/server/src/api";
import {
  hashAdminPassword,
  type AdminAuthSession,
  type AdminAuthUser
} from "../../../apps/admin-console/server/src/auth";
import type {
  AdminAuditEventsResult,
  AdminChunkDetail,
  AdminJobListFilters,
  AdminJobSummary,
  AdminOverviewKpis,
  AdminPageDetail,
  AdminPageListFilters,
  AdminPageListItem,
  AdminSourceHealth,
  PaginatedResult,
  RetrievalKpis
} from "../../../apps/admin-console/server/src/read-models";

const now = "2026-05-14T12:00:00.000Z";

function sampleJob(overrides: Partial<AdminJobSummary> = {}): AdminJobSummary {
  return {
    id: 7,
    sourceId: "bun",
    url: "https://bun.com/docs/runtime",
    jobType: "page",
    reason: "manual",
    status: "failed",
    priority: 10,
    attemptCount: 1,
    lastError: "boom",
    runAfter: now,
    startedAt: now,
    finishedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function sampleKpis(): RetrievalKpis {
  return {
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

function sampleOverview(): AdminOverviewKpis {
  return {
    ...sampleKpis(),
    window: "24h",
    windowStartedAt: "2026-05-13T12:00:00.000Z",
    generatedAt: now,
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
    failedJobs: 1
  };
}

function sampleSource(): AdminSourceHealth {
  return {
    sourceId: "bun",
    displayName: "Bun docs",
    enabled: true,
    allowedUrlPatterns: ["https://bun.com/docs/*"],
    defaultTtlSeconds: 604800,
    pageCount: 2,
    chunkCount: 3,
    embeddingCount: 2,
    embeddedChunkCount: 2,
    embeddingCoverage: 2 / 3,
    stalePages: 1,
    tombstonedPages: 0,
    oldestFetchedPage: now,
    newestIndexedPage: now,
    latestSuccessfulJob: sampleJob({ id: 8, status: "succeeded", lastError: null }),
    latestFailedJob: sampleJob()
  };
}

function samplePage(): AdminPageDetail {
  return {
    id: 10,
    sourceId: "bun",
    url: "https://bun.com/docs/runtime",
    canonicalUrl: "https://bun.com/docs/runtime",
    title: "Runtime",
    httpStatus: 200,
    contentHash: "page-hash",
    freshness: "fresh",
    fetchedAt: now,
    indexedAt: now,
    expiresAt: null,
    tombstonedAt: null,
    tombstoneReason: null,
    chunkCount: 1,
    embeddingCount: 1,
    hasEmbedding: true,
    content: "Runtime docs",
    chunks: [
      {
        id: 20,
        chunkIndex: 0,
        headingPath: ["Runtime"],
        tokenEstimate: 4,
        contentHash: "chunk-hash",
        embeddingCount: 1,
        hasEmbedding: true
      }
    ]
  };
}

function samplePageListItem(): AdminPageListItem {
  const { content: _content, chunks: _chunks, ...page } = samplePage();
  return page;
}

function sampleChunk(): AdminChunkDetail {
  return {
    id: 20,
    sourceId: "bun",
    pageId: 10,
    pageTitle: "Runtime",
    pageUrl: "https://bun.com/docs/runtime",
    pageCanonicalUrl: "https://bun.com/docs/runtime",
    pageTombstonedAt: null,
    title: "Runtime",
    headingPath: ["Runtime"],
    chunkIndex: 0,
    content: "Runtime docs",
    contentHash: "chunk-hash",
    tokenEstimate: 4,
    embeddingCount: 1,
    hasEmbedding: true,
    previousChunkId: null,
    nextChunkId: null,
    createdAt: now,
    updatedAt: now
  };
}

class MemoryAuthStore implements AdminApiAuthStore {
  users = new Map<number, AdminAuthUser>();
  sessions = new Map<string, AdminAuthSession>();

  async getUserByEmail(email: string): Promise<AdminAuthUser | null> {
    const normalized = email.trim().toLowerCase();
    return [...this.users.values()].find((user) => user.email.toLowerCase() === normalized) ?? null;
  }

  async getUserById(id: number): Promise<AdminAuthUser | null> {
    return this.users.get(id) ?? null;
  }

  async createSession(input: {
    readonly userId: number;
    readonly sessionTokenHash: string;
    readonly expiresAt: string;
    readonly userAgentHash?: string;
    readonly ipHash?: string;
    readonly now: string;
  }): Promise<AdminAuthSession> {
    const user = this.users.get(input.userId);

    if (user === undefined) {
      throw new Error("Expected user.");
    }

    const session: AdminAuthSession = {
      id: this.sessions.size + 1,
      userId: user.id,
      email: user.email,
      role: user.role,
      sessionTokenHash: input.sessionTokenHash,
      expiresAt: input.expiresAt,
      revokedAt: null
    };

    this.sessions.set(input.sessionTokenHash, session);
    return session;
  }

  async getSessionByTokenHash(sessionTokenHash: string, currentTime: string): Promise<AdminAuthSession | null> {
    const session = this.sessions.get(sessionTokenHash);

    if (session === undefined || session.revokedAt !== null || Date.parse(session.expiresAt) <= Date.parse(currentTime)) {
      return null;
    }

    return session;
  }

  async revokeSession(sessionTokenHash: string, revokedAt: string): Promise<boolean> {
    const session = this.sessions.get(sessionTokenHash);

    if (session === undefined) {
      return false;
    }

    this.sessions.set(sessionTokenHash, {
      ...session,
      revokedAt
    });

    return true;
  }
}

class FakeReadModels implements AdminReadModels {
  overviewCalls: Array<{ window: string; now: string }> = [];

  async getOverview(input: { readonly window: "1h" | "24h" | "7d" | "30d"; readonly now: string }): Promise<AdminOverviewKpis> {
    this.overviewCalls.push(input);
    return { ...sampleOverview(), window: input.window };
  }

  async getRetrievalKpis(): Promise<RetrievalKpis> {
    return sampleKpis();
  }

  async listSourceHealth(): Promise<readonly AdminSourceHealth[]> {
    return [sampleSource()];
  }

  async getSourceHealth(input: { readonly sourceId: string }): Promise<AdminSourceHealth | null> {
    return input.sourceId === "bun" ? sampleSource() : null;
  }

  async listPages(input: AdminPageListFilters): Promise<PaginatedResult<AdminPageListItem>> {
    return {
      items: [samplePageListItem()].filter((page) => input.freshness === undefined || page.freshness === input.freshness),
      nextCursor: null
    };
  }

  async getPageDetail(input: { readonly pageId: number }): Promise<AdminPageDetail | null> {
    return input.pageId === 10 ? samplePage() : null;
  }

  async getChunkDetail(input: { readonly chunkId: number }): Promise<AdminChunkDetail | null> {
    return input.chunkId === 20 ? sampleChunk() : null;
  }

  async listJobs(_input?: AdminJobListFilters): Promise<PaginatedResult<AdminJobSummary>> {
    return {
      items: [sampleJob()],
      nextCursor: null
    };
  }

  async getJobDetail(jobId: number): Promise<AdminJobSummary | null> {
    return jobId === 7 ? sampleJob() : null;
  }

  async listAuditEvents(): Promise<AdminAuditEventsResult> {
    return {
      available: false,
      items: [],
      nextCursor: null,
      reason: "admin_audit_events table is not available yet."
    };
  }
}

class FakeSearchService implements AdminSearchService {
  calls: unknown[] = [];

  async search(input: unknown) {
    this.calls.push(input);

    return {
      ok: true as const,
      generatedAt: now,
      query: "Bun.serve",
      sourceId: "bun",
      mode: "hybrid" as const,
      limit: 5,
      results: [
        {
          chunkId: 20,
          pageId: 10,
          title: "Runtime",
          url: "https://bun.com/docs/runtime",
          headingPath: ["Runtime"],
          snippet: "Use Bun.serve",
          score: 2,
          keywordScore: 1,
          vectorScore: 0.5,
          rerankScore: 0.5,
          fetchedAt: now,
          indexedAt: now,
          contentHash: "chunk-hash"
        }
      ],
      sources: [
        {
          title: "Runtime",
          url: "https://bun.com/docs/runtime",
          sourceType: "bun-docs",
          fetchedAt: now,
          contentHash: "chunk-hash"
        }
      ],
      freshness: "fresh" as const,
      confidence: "high" as const,
      refreshQueued: false,
      retrieval: {
        mode: "hybrid" as const,
        keywordAttempted: true,
        vectorAttempted: true,
        keywordResultCount: 1,
        vectorResultCount: 1,
        mergedResultCount: 1,
        queryHash: "query-hash"
      },
      warnings: []
    };
  }
}

async function makeApp() {
  const authStore = new MemoryAuthStore();
  authStore.users.set(1, {
    id: 1,
    email: "admin@example.com",
    passwordHash: await hashAdminPassword("admin-password"),
    role: "admin",
    disabledAt: null
  });
  authStore.users.set(2, {
    id: 2,
    email: "viewer@example.com",
    passwordHash: await hashAdminPassword("viewer-password"),
    role: "viewer",
    disabledAt: null
  });

  const readModels = new FakeReadModels();
  const searchService = new FakeSearchService();
  const app = createAdminApiRoutes({
    authStore,
    readModels,
    searchService,
    now: () => now,
    secureCookies: false,
    sessionTtlSeconds: 3600
  });

  return { app, readModels, searchService };
}

async function loginCookie(app: ReturnType<typeof createAdminApiRoutes>, email = "viewer@example.com", password = "viewer-password"): Promise<string> {
  const response = await app.request("/auth/login", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({ email, password })
  });
  const setCookie = response.headers.get("set-cookie");

  if (setCookie === null) {
    throw new Error("Expected session cookie.");
  }

  return setCookie.split(";")[0] ?? setCookie;
}

describe("admin API routes", () => {
  test("unauthenticated read requests are rejected", async () => {
    const { app } = await makeApp();
    const response = await app.request("/overview");
    const body = adminErrorResponseSchema.parse(await response.json());

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("unauthorized");
  });

  test("viewer can log in and access contracted read routes", async () => {
    const { app } = await makeApp();
    const cookie = await loginCookie(app);
    const meResponse = await app.request("/auth/me", { headers: { cookie } });
    const overviewResponse = await app.request("/overview?window=24h", { headers: { cookie } });
    const overviewBody = adminOverviewResponseSchema.parse(await overviewResponse.json());

    expect(meResponse.status).toBe(200);
    expect(overviewResponse.status).toBe(200);
    expect(overviewBody.overview.totalSources).toBe(1);
  });

  test("invalid query parameters return stable validation errors", async () => {
    const { app } = await makeApp();
    const cookie = await loginCookie(app);
    const response = await app.request("/overview?window=90d", { headers: { cookie } });
    const body = adminErrorResponseSchema.parse(await response.json());

    expect(response.status).toBe(400);
    expect(body.error).toEqual({
      code: "invalid_input",
      message: "Invalid window query parameter.",
      status: 400
    });
  });

  test("source, page, chunk, job, and audit routes return read model data", async () => {
    const { app } = await makeApp();
    const cookie = await loginCookie(app);

    expect((await app.request("/sources", { headers: { cookie } })).status).toBe(200);
    expect((await app.request("/sources/bun", { headers: { cookie } })).status).toBe(200);
    expect((await app.request("/sources/bun/pages?freshness=fresh&hasEmbedding=true", { headers: { cookie } })).status).toBe(200);
    expect((await app.request("/sources/bun/pages/10", { headers: { cookie } })).status).toBe(200);
    expect((await app.request("/sources/bun/chunks/20", { headers: { cookie } })).status).toBe(200);
    expect((await app.request("/jobs?status=failed", { headers: { cookie } })).status).toBe(200);
    expect((await app.request("/jobs/7", { headers: { cookie } })).status).toBe(200);
    expect((await app.request("/audit-events", { headers: { cookie } })).status).toBe(200);
  });

  test("search route delegates to the injected docs retrieval service", async () => {
    const { app, searchService } = await makeApp();
    const cookie = await loginCookie(app);
    const response = await app.request("/search", {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        query: "Bun.serve",
        sourceId: "bun",
        mode: "hybrid",
        limit: 5
      })
    });
    const body = adminSearchResponseSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(body.results[0]?.chunkId).toBe(20);
    expect(searchService.calls).toEqual([
      {
        query: "Bun.serve",
        sourceId: "bun",
        mode: "hybrid",
        limit: 5
      }
    ]);
  });
});
