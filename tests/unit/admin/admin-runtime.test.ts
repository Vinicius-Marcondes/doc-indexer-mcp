import { describe, expect, test } from "bun:test";
import { adminErrorResponseSchema, adminSearchResponseSchema } from "../../../packages/admin-contracts/src";
import {
  createAdminRuntimeApp,
  parseAdminRuntimeConfig,
  SearchDocsAdminSearchService
} from "../../../apps/admin-console/server/src/runtime";
import type {
  DocsRetrievalInput,
  DocsRetrievalResult
} from "../../../src/docs/retrieval/hybrid-retrieval";
import type { EnqueueRefreshJobInput, EnqueueRefreshJobResult } from "../../../src/docs/refresh/refresh-queue";
import { defaultDocsSourceRegistry } from "../../../src/docs/sources/bun-source-pack";
import type { SqlClient } from "../../../src/docs/storage/database";

const now = "2026-05-15T12:00:00.000Z";

function validEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    DATABASE_URL: "postgres://docs:docs-password@localhost:5432/docs",
    EMBEDDING_PROVIDER: "openai",
    OPENAI_API_KEY: "test-openai-key",
    OPENAI_EMBEDDING_MODEL: "text-embedding-3-small",
    OPENAI_EMBEDDING_DIMENSIONS: "1536",
    ADMIN_HTTP_HOST: "127.0.0.1",
    ADMIN_HTTP_PORT: "3101",
    ADMIN_COOKIE_SECURE: "false",
    ADMIN_SESSION_TTL_SECONDS: "3600",
    ADMIN_LOGIN_RATE_LIMIT_WINDOW_SECONDS: "900",
    ADMIN_LOGIN_RATE_LIMIT_MAX_ATTEMPTS: "10",
    DOCS_SEARCH_DEFAULT_LIMIT: "5",
    DOCS_SEARCH_MAX_LIMIT: "20",
    DOCS_REFRESH_MAX_PAGES_PER_RUN: "500",
    DOCS_REFRESH_MAX_EMBEDDINGS_PER_RUN: "2000",
    ...overrides
  };
}

function fakeSql(): SqlClient {
  let sqlRef: SqlClient;
  const query = async () => [];
  const sql = Object.assign(query, {
    unsafe: async () => [],
    begin: async <T>(callback: (sql: SqlClient) => Promise<T>) => callback(sqlRef),
    end: async () => undefined
  });

  sqlRef = sql as unknown as SqlClient;
  return sqlRef;
}

class CapturingRetrieval {
  readonly calls: DocsRetrievalInput[] = [];

  async search(input: DocsRetrievalInput): Promise<DocsRetrievalResult> {
    this.calls.push(input);
    const mode = input.mode ?? "hybrid";

    return {
      query: input.query.trim(),
      sourceId: input.sourceId,
      mode,
      limit: input.limit ?? 5,
      results: [],
      freshness: "missing",
      confidence: "low",
      lowConfidence: true,
      refreshQueued: false,
      refreshReason: "missing_content",
      retrieval: {
        mode,
        keywordAttempted: mode === "keyword" || mode === "hybrid",
        vectorAttempted: mode === "semantic" || mode === "hybrid",
        keywordResultCount: 0,
        vectorResultCount: 0,
        mergedResultCount: 0,
        queryHash: "query-hash"
      },
      warnings: []
    };
  }
}

class CapturingRefreshQueue {
  readonly calls: EnqueueRefreshJobInput[] = [];

  async enqueue(input: EnqueueRefreshJobInput): Promise<EnqueueRefreshJobResult> {
    this.calls.push(input);

    return {
      status: "queued",
      priority: 50,
      runAfter: now,
      job: {
        id: 11,
        sourceId: input.sourceId,
        url: input.url ?? null,
        jobType: input.jobType,
        reason: input.reason,
        status: "queued",
        priority: 50,
        runAfter: now,
        lastError: null
      }
    };
  }
}

describe("admin runtime", () => {
  test("admin runtime config does not require MCP bearer token", () => {
    const result = parseAdminRuntimeConfig(validEnv({ MCP_BEARER_TOKEN: undefined }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.http).toEqual({ host: "127.0.0.1", port: 3101 });
      expect(result.config.database.url).toBe("postgres://docs:docs-password@localhost:5432/docs");
      expect(result.config.embeddings.model).toBe("text-embedding-3-small");
      expect(result.config.auth.secureCookies).toBe(false);
    }
  });

  test("admin runtime config validates required database and embedding settings", () => {
    const result = parseAdminRuntimeConfig(validEnv({ DATABASE_URL: undefined, EMBEDDING_PROVIDER: "other" }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.issues.map((issue) => issue.path)).toContain("DATABASE_URL");
      expect(result.error.issues.map((issue) => issue.path)).toContain("EMBEDDING_PROVIDER");
    }
  });

  test("runtime app mounts the admin API for the standalone server", async () => {
    const result = await createAdminRuntimeApp({
      env: validEnv(),
      sql: fakeSql(),
      now: () => now,
      bootstrap: false,
      seedSources: false
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const response = await result.app.request("/api/admin/auth/me");
    const body = adminErrorResponseSchema.parse(await response.json());

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("unauthorized");
  });

  test("admin search service delegates to the same docs retrieval path and refresh queue", async () => {
    const retrieval = new CapturingRetrieval();
    const refreshQueue = new CapturingRefreshQueue();
    const service = new SearchDocsAdminSearchService({
      retrieval,
      refreshQueue,
      sourceRegistry: defaultDocsSourceRegistry,
      now: () => now,
      defaultLimit: 5,
      maxLimit: 20
    });
    const result = await service.search({
      query: "Bun.serve",
      sourceId: "bun",
      mode: "keyword",
      limit: 3,
      forceRefresh: true
    });

    expect(adminSearchResponseSchema.parse(result)).toMatchObject({
      ok: true,
      query: "Bun.serve",
      mode: "keyword",
      limit: 3,
      refreshQueued: true
    });
    expect(retrieval.calls).toEqual([{ sourceId: "bun", query: "Bun.serve", limit: 3, mode: "keyword" }]);
    expect(refreshQueue.calls).toEqual([
      {
        sourceId: "bun",
        jobType: "source_index",
        reason: "manual",
        prioritySignals: {
          recentRequestCount: 1,
          lowConfidenceSearchCount: 1
        }
      }
    ]);
  });
});
