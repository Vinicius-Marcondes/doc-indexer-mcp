import { describe, expect, test } from "bun:test";
import { RemoteDocsStorage } from "../../../src/docs/storage/docs-storage";
import type { SqlClient } from "../../../src/docs/storage/database";
import { createRemoteDocsTestDatabase } from "./test-harness";

function embedding1536(firstValue = 0.1): number[] {
  return Array.from({ length: 1536 }, (_, index) => (index === 0 ? firstValue : 0));
}

describe("remote docs storage access", () => {
  test("rejects embedding dimension mismatch before SQL execution", async () => {
    let sqlCalls = 0;
    const sql = (() => {
      sqlCalls += 1;
      throw new Error("SQL should not run for invalid dimensions.");
    }) as never;
    const storage = new RemoteDocsStorage(sql);

    try {
      await storage.insertEmbedding({
        chunkId: 1,
        provider: "openai",
        model: "text-embedding-3-small",
        embeddingVersion: "v1",
        dimensions: 1536,
        embedding: [1, 2]
      });
      throw new Error("Expected dimension validation to fail.");
    } catch (error) {
      expect(String(error)).toContain("Embedding length");
    }

    expect(sqlCalls).toBe(0);
  });

  test("rejects incompatible existing embedding dimensions after idempotent insert conflict", async () => {
    let sqlCalls = 0;
    const sql = (async () => {
      sqlCalls += 1;

      if (sqlCalls === 1) {
        return [];
      }

      return [
        {
          id: 7,
          chunk_id: 42,
          provider: "openai",
          model: "text-embedding-3-small",
          embedding_version: "v1",
          dimensions: 768
        }
      ];
    }) as unknown as SqlClient;
    const storage = new RemoteDocsStorage(sql);

    await expect(
      storage.insertEmbedding({
        chunkId: 42,
        provider: "openai",
        model: "text-embedding-3-small",
        embeddingVersion: "v1",
        dimensions: 1536,
        embedding: embedding1536()
      })
    ).rejects.toThrow("Existing embedding dimensions");
    expect(sqlCalls).toBe(2);
  });

  const postgresTest = process.env.TEST_DATABASE_URL === undefined ? test.skip : test;

  postgresTest("inserts duplicate embeddings idempotently without overwriting the original vector", async () => {
    const database = await createRemoteDocsTestDatabase();

    if (database === null) {
      throw new Error("TEST_DATABASE_URL is required for this test.");
    }

    const storage = new RemoteDocsStorage(database.sql);

    try {
      await storage.upsertSource({
        sourceId: "bun",
        displayName: "Bun docs",
        allowedUrlPatterns: ["https://bun.com/docs/*"],
        defaultTtlSeconds: 604800,
        enabled: true
      });
      const page = await storage.upsertPage({
        sourceId: "bun",
        url: "https://bun.com/docs/runtime",
        canonicalUrl: "https://bun.com/docs/runtime",
        title: "Runtime",
        content: "Runtime docs",
        contentHash: "page-hash",
        httpStatus: 200,
        fetchedAt: "2026-05-14T12:00:00.000Z",
        indexedAt: "2026-05-14T12:00:00.000Z"
      });
      const [chunk] = await storage.insertChunks({
        sourceId: "bun",
        pageId: page.id,
        chunks: [
          {
            url: page.url,
            title: page.title,
            headingPath: ["Runtime"],
            chunkIndex: 0,
            content: "Bun runtime docs",
            contentHash: "chunk-0",
            tokenEstimate: 3
          }
        ]
      });

      if (chunk === undefined) {
        throw new Error("Expected inserted chunk.");
      }

      const first = await storage.insertEmbedding({
        chunkId: chunk.id,
        provider: "openai",
        model: "text-embedding-3-small",
        embeddingVersion: "v1",
        dimensions: 1536,
        embedding: embedding1536(0.1)
      });
      const second = await storage.insertEmbedding({
        chunkId: chunk.id,
        provider: "openai",
        model: "text-embedding-3-small",
        embeddingVersion: "v1",
        dimensions: 1536,
        embedding: embedding1536(0.9)
      });
      const rows = await database.sql<{ count: number; stored_vector: string }[]>`
        select count(*)::int as count, max(embedding::text) as stored_vector
        from doc_embeddings
        where chunk_id = ${chunk.id}
          and provider = 'openai'
          and model = 'text-embedding-3-small'
          and embedding_version = 'v1'
      `;

      expect(second.id).toBe(first.id);
      expect(rows[0]?.count).toBe(1);
      expect(rows[0]?.stored_vector.startsWith("[0.1,")).toBe(true);
    } finally {
      await database.cleanup();
    }
  });

  postgresTest("persists docs entities in an isolated Postgres schema", async () => {
    const database = await createRemoteDocsTestDatabase();

    if (database === null) {
      throw new Error("TEST_DATABASE_URL is required for this test.");
    }

    const storage = new RemoteDocsStorage(database.sql);

    try {
      const source = await storage.upsertSource({
        sourceId: "bun",
        displayName: "Bun docs",
        allowedUrlPatterns: ["https://bun.com/docs/*"],
        defaultTtlSeconds: 604800,
        enabled: true
      });
      const readSource = await storage.getSource("bun");

      expect(source.sourceId).toBe("bun");
      expect(readSource?.displayName).toBe("Bun docs");

      const page = await storage.upsertPage({
        sourceId: "bun",
        url: "https://bun.com/docs/runtime",
        canonicalUrl: "https://bun.com/docs/runtime",
        title: "Runtime",
        content: "Runtime docs",
        contentHash: "page-hash",
        httpStatus: 200,
        fetchedAt: "2026-05-14T12:00:00.000Z",
        indexedAt: "2026-05-14T12:00:00.000Z",
        expiresAt: "2026-05-21T12:00:00.000Z"
      });

      const chunks = await storage.insertChunks({
        sourceId: "bun",
        pageId: page.id,
        chunks: [
          {
            url: page.url,
            title: "Runtime",
            headingPath: ["Runtime"],
            chunkIndex: 0,
            content: "Bun runtime docs",
            contentHash: "chunk-0",
            tokenEstimate: 3
          },
          {
            url: page.url,
            title: "Runtime",
            headingPath: ["Runtime", "APIs"],
            chunkIndex: 1,
            content: "Bun API docs",
            contentHash: "chunk-1",
            tokenEstimate: 3
          }
        ]
      });
      const readChunks = await storage.getChunksForPage(page.id);

      expect(chunks).toHaveLength(2);
      expect(readChunks.map((chunk) => chunk.contentHash)).toEqual(["chunk-0", "chunk-1"]);

      const firstChunk = chunks[0];

      if (firstChunk === undefined) {
        throw new Error("Expected first inserted chunk.");
      }

      const embedding = await storage.insertEmbedding({
        chunkId: firstChunk.id,
        provider: "openai",
        model: "text-embedding-3-small",
        embeddingVersion: "v1",
        dimensions: 1536,
        embedding: embedding1536()
      });

      expect(embedding.chunkId).toBe(firstChunk.id);
      expect(embedding.dimensions).toBe(1536);

      const refreshJob = await storage.createRefreshJob({
        sourceId: "bun",
        url: page.url,
        jobType: "page",
        reason: "stale_content",
        priority: 10
      });

      expect(refreshJob.status).toBe("queued");

      const retrievalEvent = await storage.recordRetrievalEvent({
        sourceId: "bun",
        queryHash: "query-hash",
        mode: "hybrid",
        resultCount: 2,
        confidence: "high",
        lowConfidence: false,
        refreshQueued: false
      });

      expect(retrievalEvent.queryHash).toBe("query-hash");
    } finally {
      await database.cleanup();
    }
  });
});
