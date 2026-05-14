import { describe, expect, test } from "bun:test";
import {
  PostgresVectorRetrieval,
  boundVectorRetrievalLimit
} from "../../../../src/docs/retrieval/vector-retrieval";
import type { EmbedTextsRequest, EmbedTextsResult, EmbeddingProvider, EmbeddingProviderMetadata } from "../../../../src/docs/embeddings/provider";
import { FakeEmbeddingProvider } from "../../../../src/docs/embeddings/fake-provider";
import { createStructuredError } from "../../../../src/shared/errors";
import { RemoteDocsStorage, type DocChunk, type InsertChunkInput } from "../../../../src/docs/storage/docs-storage";
import { createRemoteDocsTestDatabase } from "../../storage/test-harness";

const now = "2026-05-14T12:00:00.000Z";
const providerMetadata: EmbeddingProviderMetadata = {
  provider: "fake",
  model: "fake-semantic",
  dimensions: 1536,
  embeddingVersion: "fake-semantic:v1"
};

function vector1536(axis: 0 | 1 | 2, value = 1): number[] {
  return Array.from({ length: 1536 }, (_, index) => (index === axis ? value : 0));
}

class ControlledEmbeddingProvider implements EmbeddingProvider {
  readonly metadata = providerMetadata;
  readonly calls: EmbedTextsRequest[] = [];

  constructor(private readonly queryVector = vector1536(0)) {}

  async embedTexts(request: EmbedTextsRequest): Promise<EmbedTextsResult> {
    this.calls.push(request);
    return {
      ok: true,
      metadata: this.metadata,
      embeddings: request.texts.map((text, index) => ({
        index,
        text,
        vector: this.queryVector
      }))
    };
  }
}

class MismatchedDimensionProvider implements EmbeddingProvider {
  readonly metadata = providerMetadata;

  async embedTexts(request: EmbedTextsRequest): Promise<EmbedTextsResult> {
    return {
      ok: true,
      metadata: this.metadata,
      embeddings: request.texts.map((text, index) => ({
        index,
        text,
        vector: [1, 0]
      }))
    };
  }
}

async function seedChunks(storage: RemoteDocsStorage, sourceId = "bun"): Promise<DocChunk[]> {
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
      title: "Background refresh",
      headingPath: ["Runtime", "Background refresh"],
      chunkIndex: 0,
      content: "Refresh jobs run away from user requests so documentation indexing stays responsive.",
      contentHash: `${sourceId}-refresh`,
      tokenEstimate: 12
    },
    {
      url: page.url,
      title: "Package manager",
      headingPath: ["Package manager", "Install"],
      chunkIndex: 1,
      content: "Install dependencies with bun install and lock dependency resolution with bun.lock.",
      contentHash: `${sourceId}-pm`,
      tokenEstimate: 12
    },
    {
      url: page.url,
      title: "Test runner",
      headingPath: ["Test runner"],
      chunkIndex: 2,
      content: "Use bun:test for unit and integration tests.",
      contentHash: `${sourceId}-test`,
      tokenEstimate: 8
    }
  ];

  return storage.insertChunks({ sourceId, pageId: page.id, chunks });
}

async function seedEmbeddings(storage: RemoteDocsStorage, chunks: readonly DocChunk[]): Promise<void> {
  const [refresh, packageManager, testRunner] = chunks;

  if (refresh === undefined || packageManager === undefined || testRunner === undefined) {
    throw new Error("Expected three chunks.");
  }

  await storage.insertEmbedding({
    chunkId: refresh.id,
    ...providerMetadata,
    embedding: vector1536(0)
  });
  await storage.insertEmbedding({
    chunkId: packageManager.id,
    ...providerMetadata,
    embedding: vector1536(1)
  });
  await storage.insertEmbedding({
    chunkId: testRunner.id,
    ...providerMetadata,
    embedding: vector1536(2)
  });
}

const postgresTest = process.env.TEST_DATABASE_URL === undefined ? test.skip : test;

describe("Postgres vector retrieval", () => {
  test("limit is bounded", () => {
    expect(boundVectorRetrievalLimit(undefined, 5, 20)).toBe(5);
    expect(boundVectorRetrievalLimit(2, 5, 20)).toBe(2);
    expect(boundVectorRetrievalLimit(200, 5, 20)).toBe(20);
    expect(boundVectorRetrievalLimit(0, 5, 20)).toBe(1);
  });

  test("provider failure surfaces structured error before querying Postgres", async () => {
    let sqlCalls = 0;
    const sql = (() => {
      sqlCalls += 1;
      throw new Error("SQL should not run when embedding generation fails.");
    }) as never;
    const retrieval = new PostgresVectorRetrieval({
      sql,
      embeddingProvider: new FakeEmbeddingProvider({
        dimensions: 1536,
        failWith: createStructuredError("fetch_failed", "Embedding provider request failed.", {
          provider: "fake",
          reason: "rate_limited"
        })
      }),
      defaultLimit: 5,
      maxLimit: 20
    });

    const result = await retrieval.search({ sourceId: "bun", query: "background refresh" });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected provider failure.");
    }
    expect(result.error.code).toBe("fetch_failed");
    expect(sqlCalls).toBe(0);
  });

  test("query vector dimension mismatch is rejected before querying Postgres", async () => {
    let sqlCalls = 0;
    const sql = (() => {
      sqlCalls += 1;
      throw new Error("SQL should not run for invalid query embeddings.");
    }) as never;
    const retrieval = new PostgresVectorRetrieval({
      sql,
      embeddingProvider: new MismatchedDimensionProvider(),
      defaultLimit: 5,
      maxLimit: 20
    });

    const result = await retrieval.search({ sourceId: "bun", query: "background refresh" });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected dimension validation failure.");
    }
    expect(result.error.code).toBe("invalid_input");
    expect(result.error.details).toMatchObject({
      expectedDimensions: 1536,
      actualDimensions: 2
    });
    expect(sqlCalls).toBe(0);
  });

  postgresTest("semantic query returns nearest chunk using deterministic fake vectors", async () => {
    const database = await createRemoteDocsTestDatabase();

    if (database === null) {
      throw new Error("TEST_DATABASE_URL is required for this test.");
    }

    try {
      const storage = new RemoteDocsStorage(database.sql);
      const chunks = await seedChunks(storage);
      await seedEmbeddings(storage, chunks);
      const provider = new ControlledEmbeddingProvider(vector1536(0));
      const retrieval = new PostgresVectorRetrieval({
        sql: database.sql,
        embeddingProvider: provider,
        defaultLimit: 5,
        maxLimit: 20
      });

      const result = await retrieval.search({ sourceId: "bun", query: "How should indexing happen without blocking requests?", limit: 2 });

      expect(result.ok).toBe(true);
      expect(provider.calls).toHaveLength(1);
      expect(provider.calls[0]?.texts).toEqual(["How should indexing happen without blocking requests?"]);
      expect(result.results[0]).toMatchObject({
        title: "Background refresh",
        headingPath: ["Runtime", "Background refresh"],
        keywordScore: 0,
        rerankScore: 0
      });
      expect(result.results[0]?.vectorScore).toBeGreaterThan(result.results[1]?.vectorScore ?? -1);
      expect(result.results[0]?.snippet).toContain("Refresh jobs run");
    } finally {
      await database.cleanup();
    }
  });

  postgresTest("source filter is honored", async () => {
    const database = await createRemoteDocsTestDatabase();

    if (database === null) {
      throw new Error("TEST_DATABASE_URL is required for this test.");
    }

    try {
      const storage = new RemoteDocsStorage(database.sql);
      const bunChunks = await seedChunks(storage, "bun");
      const otherChunks = await seedChunks(storage, "other");
      await seedEmbeddings(storage, bunChunks);
      await seedEmbeddings(storage, otherChunks);
      const retrieval = new PostgresVectorRetrieval({
        sql: database.sql,
        embeddingProvider: new ControlledEmbeddingProvider(vector1536(0)),
        defaultLimit: 5,
        maxLimit: 20
      });

      const result = await retrieval.search({ sourceId: "other", query: "background work" });

      expect(result.ok).toBe(true);
      expect(result.results).toHaveLength(3);
      expect(result.results.every((item) => item.url.startsWith("https://other.example/"))).toBe(true);
    } finally {
      await database.cleanup();
    }
  });

  postgresTest("provider model and version filter is honored", async () => {
    const database = await createRemoteDocsTestDatabase();

    if (database === null) {
      throw new Error("TEST_DATABASE_URL is required for this test.");
    }

    try {
      const storage = new RemoteDocsStorage(database.sql);
      const [refresh, packageManager] = await seedChunks(storage);

      if (refresh === undefined || packageManager === undefined) {
        throw new Error("Expected seeded chunks.");
      }

      await storage.insertEmbedding({
        chunkId: refresh.id,
        provider: providerMetadata.provider,
        model: "older-model",
        embeddingVersion: "older-model:v1",
        dimensions: 1536,
        embedding: vector1536(0)
      });
      await storage.insertEmbedding({
        chunkId: packageManager.id,
        ...providerMetadata,
        embedding: vector1536(1)
      });

      const retrieval = new PostgresVectorRetrieval({
        sql: database.sql,
        embeddingProvider: new ControlledEmbeddingProvider(vector1536(0)),
        defaultLimit: 5,
        maxLimit: 20
      });

      const result = await retrieval.search({ sourceId: "bun", query: "background work" });

      expect(result.ok).toBe(true);
      expect(result.results.map((item) => item.title)).toEqual(["Package manager"]);
    } finally {
      await database.cleanup();
    }
  });

  postgresTest("missing embeddings returns empty result", async () => {
    const database = await createRemoteDocsTestDatabase();

    if (database === null) {
      throw new Error("TEST_DATABASE_URL is required for this test.");
    }

    try {
      const storage = new RemoteDocsStorage(database.sql);
      await seedChunks(storage);
      const retrieval = new PostgresVectorRetrieval({
        sql: database.sql,
        embeddingProvider: new ControlledEmbeddingProvider(vector1536(0)),
        defaultLimit: 5,
        maxLimit: 20
      });

      const result = await retrieval.search({ sourceId: "bun", query: "background work" });

      expect(result.ok).toBe(true);
      expect(result.results).toEqual([]);
      expect(result.limit).toBe(5);
    } finally {
      await database.cleanup();
    }
  });
});
