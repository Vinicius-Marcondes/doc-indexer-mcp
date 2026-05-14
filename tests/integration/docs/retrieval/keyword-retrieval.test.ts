import { describe, expect, test } from "bun:test";
import {
  PostgresKeywordRetrieval,
  boundKeywordRetrievalLimit
} from "../../../../src/docs/retrieval/keyword-retrieval";
import { RemoteDocsStorage, type InsertChunkInput } from "../../../../src/docs/storage/docs-storage";
import { createRemoteDocsTestDatabase } from "../../storage/test-harness";

const now = "2026-05-14T12:00:00.000Z";

async function seedChunks(storage: RemoteDocsStorage, sourceId = "bun"): Promise<void> {
  await storage.upsertSource({
    sourceId,
    displayName: `${sourceId} docs`,
    enabled: true,
    allowedUrlPatterns: [`https://${sourceId}.example/docs/*`],
    defaultTtlSeconds: 604800
  });
  const page = await storage.upsertPage({
    sourceId,
    url: `https://${sourceId}.example/docs/runtime`,
    canonicalUrl: `https://${sourceId}.example/docs/runtime`,
    title: "Runtime",
    content: "Runtime docs",
    contentHash: `${sourceId}-page-hash`,
    httpStatus: 200,
    fetchedAt: now,
    indexedAt: now,
    expiresAt: "2026-05-21T12:00:00.000Z"
  });
  const chunks: InsertChunkInput[] = [
    {
      url: page.url,
      title: "HTTP server",
      headingPath: ["Runtime", "HTTP server"],
      chunkIndex: 0,
      content:
        sourceId === "other"
          ? "OtherOnlyToken appears only in the other source."
          : "Use Bun.serve to start an HTTP server. Bun.serve accepts a fetch handler.",
      contentHash: `${sourceId}-server`,
      tokenEstimate: 16
    },
    {
      url: page.url,
      title: "Testing",
      headingPath: ["Test runner"],
      chunkIndex: 1,
      content: "Import test from bun:test when writing tests.",
      contentHash: `${sourceId}-test`,
      tokenEstimate: 8
    },
    {
      url: page.url,
      title: "Package manager",
      headingPath: ["Package manager", "Install"],
      chunkIndex: 2,
      content: "Run bun install --frozen-lockfile to enforce bun.lock in CI.",
      contentHash: `${sourceId}-pm`,
      tokenEstimate: 10
    }
  ];

  await storage.insertChunks({ sourceId, pageId: page.id, chunks });
}

const postgresTest = process.env.TEST_DATABASE_URL === undefined ? test.skip : test;

describe("Postgres keyword retrieval", () => {
  test("limit is bounded", () => {
    expect(boundKeywordRetrievalLimit(undefined, 5, 20)).toBe(5);
    expect(boundKeywordRetrievalLimit(2, 5, 20)).toBe(2);
    expect(boundKeywordRetrievalLimit(200, 5, 20)).toBe(20);
    expect(boundKeywordRetrievalLimit(0, 5, 20)).toBe(1);
  });

  postgresTest("exact API query finds matching chunk", async () => {
    const database = await createRemoteDocsTestDatabase();

    if (database === null) {
      throw new Error("TEST_DATABASE_URL is required for this test.");
    }

    try {
      const storage = new RemoteDocsStorage(database.sql);
      await seedChunks(storage);
      const retrieval = new PostgresKeywordRetrieval({ sql: database.sql, defaultLimit: 5, maxLimit: 20 });
      const result = await retrieval.search({ sourceId: "bun", query: "Bun.serve" });

      expect(result.results[0]).toMatchObject({
        title: "HTTP server",
        headingPath: ["Runtime", "HTTP server"],
        vectorScore: 0,
        rerankScore: 0
      });
      expect(result.results[0]?.snippet).toContain("Bun.serve");
    } finally {
      await database.cleanup();
    }
  });

  postgresTest("CLI flag and package-manager query finds matching chunk", async () => {
    const database = await createRemoteDocsTestDatabase();

    if (database === null) {
      throw new Error("TEST_DATABASE_URL is required for this test.");
    }

    try {
      const storage = new RemoteDocsStorage(database.sql);
      await seedChunks(storage);
      const retrieval = new PostgresKeywordRetrieval({ sql: database.sql, defaultLimit: 5, maxLimit: 20 });
      const result = await retrieval.search({ sourceId: "bun", query: "--frozen-lockfile bun.lock" });

      expect(result.results[0]?.title).toBe("Package manager");
      expect(result.results[0]?.snippet).toContain("--frozen-lockfile");
    } finally {
      await database.cleanup();
    }
  });

  postgresTest("source filter excludes other sources", async () => {
    const database = await createRemoteDocsTestDatabase();

    if (database === null) {
      throw new Error("TEST_DATABASE_URL is required for this test.");
    }

    try {
      const storage = new RemoteDocsStorage(database.sql);
      await seedChunks(storage, "bun");
      await seedChunks(storage, "other");
      const retrieval = new PostgresKeywordRetrieval({ sql: database.sql, defaultLimit: 5, maxLimit: 20 });
      const result = await retrieval.search({ sourceId: "bun", query: "OtherOnlyToken" });

      expect(result.results).toEqual([]);
    } finally {
      await database.cleanup();
    }
  });

  postgresTest("empty result returns no fabricated content", async () => {
    const database = await createRemoteDocsTestDatabase();

    if (database === null) {
      throw new Error("TEST_DATABASE_URL is required for this test.");
    }

    try {
      const storage = new RemoteDocsStorage(database.sql);
      await seedChunks(storage);
      const retrieval = new PostgresKeywordRetrieval({ sql: database.sql, defaultLimit: 5, maxLimit: 20 });
      const result = await retrieval.search({ sourceId: "bun", query: "no-such-token" });

      expect(result.results).toEqual([]);
      expect(result.limit).toBe(5);
    } finally {
      await database.cleanup();
    }
  });

  postgresTest("scores are stable enough for deterministic ordering", async () => {
    const database = await createRemoteDocsTestDatabase();

    if (database === null) {
      throw new Error("TEST_DATABASE_URL is required for this test.");
    }

    try {
      const storage = new RemoteDocsStorage(database.sql);
      await seedChunks(storage);
      const retrieval = new PostgresKeywordRetrieval({ sql: database.sql, defaultLimit: 5, maxLimit: 20 });
      const result = await retrieval.search({ sourceId: "bun", query: "Bun.serve", limit: 2 });

      expect(result.results.map((item) => item.title)).toEqual(["HTTP server"]);
      expect(result.results[0]?.keywordScore).toBe(result.results[0]?.score);
    } finally {
      await database.cleanup();
    }
  });
});
