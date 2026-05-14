import { describe, expect, test } from "bun:test";
import { FakeEmbeddingProvider } from "../../../../src/docs/embeddings/fake-provider";
import { createEmbeddingProviderFailure, type EmbedTextsRequest, type EmbedTextsResult } from "../../../../src/docs/embeddings/provider";
import { BunDocsIngestionPipeline } from "../../../../src/docs/ingestion/ingestion-pipeline";
import { BunDocsDiscoveryClient, BUN_DOCS_PRIMARY_INDEX_URL, type DocsSourceFetchLike } from "../../../../src/docs/sources/bun-docs-discovery";
import {
  RemoteDocsStorage,
  type DocChunk,
  type DocEmbedding,
  type DocPage,
  type InsertChunksInput,
  type InsertEmbeddingInput,
  type UpsertPageInput,
  type UpsertSourceInput
} from "../../../../src/docs/storage/docs-storage";
import type { SqlClient } from "../../../../src/docs/storage/database";
import { createRemoteDocsTestDatabase } from "../../storage/test-harness";

const fetchedAt = "2026-05-14T12:00:00.000Z";
const pageUrl = "https://bun.com/docs/runtime/http/server";

function response(body: string, init: ResponseInit & { url?: string } = {}): Response {
  const result = new Response(body, init);

  if (init.url !== undefined) {
    Object.defineProperty(result, "url", { value: init.url });
  }

  return result;
}

function createFetch(pageBody: () => string): DocsSourceFetchLike {
  return async (url) => {
    if (url === BUN_DOCS_PRIMARY_INDEX_URL) {
      return response(`# Bun Docs\n\n- [HTTP server](${pageUrl})`, { status: 200, url: BUN_DOCS_PRIMARY_INDEX_URL });
    }

    if (url === pageUrl) {
      return response(pageBody(), {
        status: 200,
        headers: { "content-type": "text/html" },
        url: pageUrl
      });
    }

    return response("not found", { status: 404, url });
  };
}

function createPipeline(
  storage: RemoteDocsStorage,
  fetchImpl: DocsSourceFetchLike,
  embeddingProvider = new FakeEmbeddingProvider({ dimensions: 1536 })
): BunDocsIngestionPipeline {
  return new BunDocsIngestionPipeline({
    storage,
    discoveryClient: new BunDocsDiscoveryClient({ fetchImpl, now: () => fetchedAt }),
    embeddingProvider,
    now: () => fetchedAt
  });
}

async function rowCount(sql: SqlClient, tableName: string): Promise<number> {
  const rows = (await sql.unsafe(`select count(*)::int as count from ${tableName}`)) as Array<{ count: number }>;
  return rows[0]?.count ?? 0;
}

async function storedPageHash(sql: SqlClient): Promise<string> {
  const rows = (await sql.unsafe(
    `select content_hash from doc_pages where canonical_url = '${pageUrl}'`
  )) as Array<{ content_hash: string }>;
  const row = rows[0];

  if (row === undefined) {
    throw new Error("Expected stored page hash.");
  }

  return row.content_hash;
}

class CountingFakeEmbeddingProvider extends FakeEmbeddingProvider {
  calls = 0;
  texts = 0;

  override async embedTexts(request: EmbedTextsRequest): Promise<EmbedTextsResult> {
    this.calls += 1;
    this.texts += request.texts.length;
    return super.embedTexts(request);
  }
}

class InMemoryPartialStorage {
  page: DocPage | null = null;
  chunks: DocChunk[] = [];
  private embeddings = new Map<number, DocEmbedding>();
  private nextChunkId = 1;
  private nextEmbeddingId = 1;

  async upsertSource(_input: UpsertSourceInput): Promise<unknown> {
    return {};
  }

  async getPageByCanonicalUrl(_sourceId: string, canonicalUrl: string): Promise<DocPage | null> {
    return this.page?.canonicalUrl === canonicalUrl ? this.page : null;
  }

  async upsertPage(input: UpsertPageInput): Promise<DocPage> {
    this.page = {
      id: this.page?.id ?? 1,
      sourceId: input.sourceId,
      url: input.url,
      canonicalUrl: input.canonicalUrl,
      title: input.title,
      contentHash: input.contentHash
    };

    return this.page;
  }

  async deleteChunksForPage(_pageId: number): Promise<number> {
    const count = this.chunks.length;
    this.chunks = [];
    this.embeddings.clear();
    return count;
  }

  async insertChunks(input: InsertChunksInput): Promise<DocChunk[]> {
    this.chunks = input.chunks.map((chunk) => ({
      id: this.nextChunkId++,
      sourceId: input.sourceId,
      pageId: input.pageId,
      url: chunk.url,
      title: chunk.title,
      headingPath: chunk.headingPath,
      chunkIndex: chunk.chunkIndex,
      content: chunk.content,
      contentHash: chunk.contentHash,
      tokenEstimate: chunk.tokenEstimate
    }));

    return this.chunks;
  }

  async getChunksForPage(_pageId: number): Promise<DocChunk[]> {
    return this.chunks;
  }

  async getEmbeddingForChunk(input: { readonly chunkId: number }): Promise<DocEmbedding | null> {
    return this.embeddings.get(input.chunkId) ?? null;
  }

  async insertEmbedding(input: InsertEmbeddingInput): Promise<DocEmbedding> {
    const embedding: DocEmbedding = {
      id: this.nextEmbeddingId++,
      chunkId: input.chunkId,
      provider: input.provider,
      model: input.model,
      embeddingVersion: input.embeddingVersion,
      dimensions: input.dimensions
    };
    this.embeddings.set(input.chunkId, embedding);
    return embedding;
  }

  clearChunksAndEmbeddings(): void {
    this.chunks = [];
    this.embeddings.clear();
  }
}

const postgresTest = process.env.TEST_DATABASE_URL === undefined ? test.skip : test;

describe("docs ingestion pipeline", () => {
  postgresTest("stores source, page, chunks, and embeddings from mocked Bun docs", async () => {
    const database = await createRemoteDocsTestDatabase();

    if (database === null) {
      throw new Error("TEST_DATABASE_URL is required for this test.");
    }

    try {
      const pipeline = createPipeline(
        new RemoteDocsStorage(database.sql),
        createFetch(() => "<main><h1>HTTP server</h1><p>Use <code>Bun.serve</code>.</p></main>")
      );
      const result = await pipeline.ingestFromIndex();

      expect(result.ok).toBe(true);

      if (result.ok) {
        expect(result.summary.pagesStored).toBe(1);
        expect(result.summary.chunksStored).toBeGreaterThan(0);
        expect(result.summary.embeddingsCreated).toBe(result.summary.chunksStored);
      }

      expect(await rowCount(database.sql, "doc_sources")).toBe(1);
      expect(await rowCount(database.sql, "doc_pages")).toBe(1);
      expect(await rowCount(database.sql, "doc_chunks")).toBeGreaterThan(0);
      expect(await rowCount(database.sql, "doc_embeddings")).toBe(await rowCount(database.sql, "doc_chunks"));
    } finally {
      await database.cleanup();
    }
  });

  postgresTest("second unchanged run does not duplicate chunks or re-embed existing chunks", async () => {
    const database = await createRemoteDocsTestDatabase();

    if (database === null) {
      throw new Error("TEST_DATABASE_URL is required for this test.");
    }

    try {
      const provider = new CountingFakeEmbeddingProvider({ dimensions: 1536 });
      const pipeline = createPipeline(
        new RemoteDocsStorage(database.sql),
        createFetch(() => "<main><h1>HTTP server</h1><p>Use <code>Bun.serve</code>.</p></main>"),
        provider
      );

      const first = await pipeline.ingestFromIndex();
      const chunksAfterFirst = await rowCount(database.sql, "doc_chunks");
      const embeddingsAfterFirst = await rowCount(database.sql, "doc_embeddings");
      const providerTextsAfterFirst = provider.texts;
      const second = await pipeline.ingestFromIndex();

      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      expect(await rowCount(database.sql, "doc_chunks")).toBe(chunksAfterFirst);
      expect(await rowCount(database.sql, "doc_embeddings")).toBe(embeddingsAfterFirst);
      expect(provider.texts).toBe(providerTextsAfterFirst);

      if (second.ok) {
        expect(second.summary.chunksReused).toBe(chunksAfterFirst);
        expect(second.summary.embeddingsReused).toBe(embeddingsAfterFirst);
        expect(second.summary.embeddingsCreated).toBe(0);
      }
    } finally {
      await database.cleanup();
    }
  });

  postgresTest("changed page content updates page hash and chunk set", async () => {
    const database = await createRemoteDocsTestDatabase();

    if (database === null) {
      throw new Error("TEST_DATABASE_URL is required for this test.");
    }

    let body = "<main><h1>HTTP server</h1><p>Use <code>Bun.serve</code>.</p></main>";

    try {
      const pipeline = createPipeline(new RemoteDocsStorage(database.sql), createFetch(() => body));
      const first = await pipeline.ingestFromIndex();
      const firstHash = await storedPageHash(database.sql);

      body = "<main><h1>HTTP server</h1><p>Use <code>Bun.serve</code> with WebSocket upgrades.</p></main>";

      const second = await pipeline.ingestFromIndex();
      const secondHash = await storedPageHash(database.sql);

      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      expect(secondHash).not.toBe(firstHash);
      expect(await rowCount(database.sql, "doc_pages")).toBe(1);
      expect(await rowCount(database.sql, "doc_chunks")).toBeGreaterThan(0);

      if (second.ok) {
        expect(second.summary.pagesChanged).toBe(1);
        expect(second.summary.chunksStored).toBeGreaterThan(0);
      }
    } finally {
      await database.cleanup();
    }
  });

  postgresTest("provider failure records structured failure and does not corrupt page data", async () => {
    const database = await createRemoteDocsTestDatabase();

    if (database === null) {
      throw new Error("TEST_DATABASE_URL is required for this test.");
    }

    try {
      const provider = new FakeEmbeddingProvider({
        dimensions: 1536,
        failWith: createEmbeddingProviderFailure("fake", "provider unavailable")
      });
      const pipeline = createPipeline(
        new RemoteDocsStorage(database.sql),
        createFetch(() => "<main><h1>HTTP server</h1><p>Use <code>Bun.serve</code>.</p></main>"),
        provider
      );
      const result = await pipeline.ingestFromIndex();

      expect(result.ok).toBe(false);

      if (!result.ok) {
        expect(result.error.code).toBe("fetch_failed");
        expect(result.summary.pagesStored).toBe(1);
        expect(result.summary.chunksStored).toBeGreaterThan(0);
      }

      expect(await rowCount(database.sql, "doc_pages")).toBe(1);
      expect(await rowCount(database.sql, "doc_chunks")).toBeGreaterThan(0);
      expect(await rowCount(database.sql, "doc_embeddings")).toBe(0);
    } finally {
      await database.cleanup();
    }
  });

  test("rebuilds chunks when an unchanged page has no stored chunks", async () => {
    const storage = new InMemoryPartialStorage();
    const provider = new CountingFakeEmbeddingProvider({ dimensions: 1536 });
    const pipeline = createPipeline(
      storage as unknown as RemoteDocsStorage,
      createFetch(() => "<main><h1>HTTP server</h1><p>Use <code>Bun.serve</code>.</p></main>"),
      provider
    );
    const first = await pipeline.ingestPage(pageUrl);

    expect(first.ok).toBe(true);
    expect(storage.chunks.length).toBeGreaterThan(0);

    storage.clearChunksAndEmbeddings();

    const second = await pipeline.ingestPage(pageUrl);

    expect(second.ok).toBe(true);
    expect(storage.chunks.length).toBeGreaterThan(0);

    if (second.ok) {
      expect(second.summary.pagesUnchanged).toBe(1);
      expect(second.summary.chunksStored).toBe(storage.chunks.length);
      expect(second.summary.embeddingsCreated).toBe(storage.chunks.length);
      expect(second.summary.chunksReused).toBe(0);
    }
  });

  test("disallowed URL is rejected before fetch", async () => {
    let fetchCalls = 0;
    const pipeline = new BunDocsIngestionPipeline({
      storage: {} as RemoteDocsStorage,
      discoveryClient: new BunDocsDiscoveryClient({
        fetchImpl: async () => {
          fetchCalls += 1;
          return response("should not fetch");
        },
        now: () => fetchedAt
      }),
      embeddingProvider: new FakeEmbeddingProvider({ dimensions: 1536 }),
      now: () => fetchedAt
    });

    const result = await pipeline.ingestPage("https://example.com/docs/runtime/http/server");

    expect(result.ok).toBe(false);
    expect(fetchCalls).toBe(0);

    if (!result.ok) {
      expect(result.error.code).toBe("disallowed_source");
    }
  });
});
