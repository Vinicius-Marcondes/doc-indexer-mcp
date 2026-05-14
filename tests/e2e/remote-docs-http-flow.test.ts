import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createRemoteHttpApp } from "../../src/http/app";
import { createRemoteDocsMcpHandler } from "../../src/http/mcp";
import { createServerDependencies } from "../../src/server";
import { FakeEmbeddingProvider } from "../../src/docs/embeddings/fake-provider";
import type { EmbeddingProviderMetadata } from "../../src/docs/embeddings/provider";
import { BunDocsIngestionPipeline } from "../../src/docs/ingestion/ingestion-pipeline";
import { RefreshJobQueue } from "../../src/docs/refresh/refresh-queue";
import { HybridDocsRetrieval } from "../../src/docs/retrieval/hybrid-retrieval";
import type { KeywordRetrievalResultItem, KeywordSearchInput, KeywordSearchResult } from "../../src/docs/retrieval/keyword-retrieval";
import type { VectorRetrievalResultItem, VectorSearchInput, VectorSearchResult } from "../../src/docs/retrieval/vector-retrieval";
import { BUN_DOCS_PRIMARY_INDEX_URL, BunDocsDiscoveryClient } from "../../src/docs/sources/bun-docs-discovery";
import { defaultDocsSourceRegistry } from "../../src/docs/sources/bun-source-pack";
import type {
  CreateRefreshJobInput,
  DocChunk,
  DocEmbedding,
  DocPage,
  DocSource,
  InsertChunksInput,
  InsertEmbeddingInput,
  RecordRetrievalEventInput,
  RefreshJob,
  RetrievalEvent,
  UpsertPageInput,
  UpsertSourceInput
} from "../../src/docs/storage/docs-storage";
import type { StoredDocsChunk, StoredDocsPage, StoredDocsSourceStats } from "../../src/resources/docs-resources";

const bearerToken = "remote-docs-http-e2e-token";
const generatedAt = "2026-05-14T12:00:00.000Z";
const fetchedAt = "2026-05-14T10:00:00.000Z";
const indexedAt = "2026-05-14T10:05:00.000Z";
const staleFetchedAt = "2026-04-01T00:00:00.000Z";
const tempDirs: string[] = [];

interface McpToolListResponse {
  readonly result: {
    readonly tools: Array<{ readonly name: string }>;
  };
}

interface McpToolCallResponse<T> {
  readonly result: {
    readonly structuredContent?: T;
    readonly content?: Array<{ readonly type: "text"; readonly text: string }>;
  };
  readonly error?: unknown;
}

interface SearchDocsStructuredResult {
  readonly ok: true;
  readonly query: string;
  readonly sourceId: string;
  readonly mode: string;
  readonly results: Array<{
    readonly chunkId: number;
    readonly pageId: number;
    readonly title: string;
    readonly url: string;
    readonly snippet: string;
    readonly contentHash: string;
    readonly keywordScore: number;
    readonly vectorScore: number;
  }>;
  readonly sources: Array<{ readonly title: string; readonly url: string; readonly contentHash: string }>;
  readonly freshness: string;
  readonly confidence: string;
  readonly refreshQueued: boolean;
  readonly refreshReason?: string;
  readonly retrieval: {
    readonly mode: string;
    readonly keywordAttempted: boolean;
    readonly vectorAttempted: boolean;
    readonly mergedResultCount: number;
  };
}

interface GetDocPageStructuredResult {
  readonly ok: true;
  readonly url: string;
  readonly title: string;
  readonly content: string;
  readonly chunks: Array<{ readonly chunkId: number; readonly content: string }>;
  readonly sources: Array<{ readonly url: string; readonly contentHash: string }>;
  readonly freshness: string;
}

interface DocsChunkResource {
  readonly ok: true;
  readonly chunkId: number;
  readonly pageId: number;
  readonly title: string;
  readonly content: string;
}

function tempCachePath(): string {
  const dir = mkdtempSync(resolve(tmpdir(), "bun-dev-intel-remote-docs-e2e-"));
  tempDirs.push(dir);
  return resolve(dir, "cache.sqlite");
}

async function mockedBunDocsFetch(url: string): Promise<Response> {
  if (url === BUN_DOCS_PRIMARY_INDEX_URL) {
    return new Response(
      [
        "# Bun docs index",
        "",
        "- [HTTP server](https://bun.com/docs/runtime/http-server)",
        "- [Test runner](https://bun.com/docs/cli/test)"
      ].join("\n"),
      { status: 200, headers: { "content-type": "text/markdown" } }
    );
  }

  if (url === "https://bun.com/docs/runtime/http-server") {
    return new Response(
      [
        "# HTTP server",
        "",
        "Use `Bun.serve` to start an HTTP server with a fetch handler.",
        "",
        "## Request routing",
        "",
        "The fetch handler receives a Request and returns a Response."
      ].join("\n"),
      { status: 200, headers: { "content-type": "text/markdown" } }
    );
  }

  return new Response("not found", { status: 404, statusText: "Not Found" });
}

function key(sourceId: string, value: string): string {
  return `${sourceId}\0${value}`;
}

function summarizePage(page: StoredDocsPage): DocPage {
  return {
    id: page.id,
    sourceId: page.sourceId,
    url: page.url,
    canonicalUrl: page.canonicalUrl,
    title: page.title,
    contentHash: page.contentHash
  };
}

class InMemoryRemoteDocsStore {
  readonly refreshJobs: RefreshJob[] = [];
  readonly retrievalEvents: RetrievalEvent[] = [];
  private readonly sources = new Map<string, DocSource>();
  private readonly pages = new Map<number, StoredDocsPage>();
  private readonly pagesByCanonicalUrl = new Map<string, number>();
  private readonly chunks = new Map<number, DocChunk>();
  private readonly chunksByPageId = new Map<number, number[]>();
  private readonly embeddings = new Map<string, DocEmbedding>();
  private sourceSeq = 1;
  private pageSeq = 10;
  private chunkSeq = 100;
  private embeddingSeq = 1000;
  private refreshJobSeq = 1;
  private retrievalEventSeq = 1;

  async upsertSource(input: UpsertSourceInput): Promise<DocSource> {
    const existing = this.sources.get(input.sourceId);
    const source: DocSource = {
      id: existing?.id ?? this.sourceSeq++,
      sourceId: input.sourceId,
      displayName: input.displayName,
      enabled: input.enabled,
      allowedUrlPatterns: input.allowedUrlPatterns,
      defaultTtlSeconds: input.defaultTtlSeconds
    };
    this.sources.set(input.sourceId, source);
    return source;
  }

  async listSourceStats(): Promise<StoredDocsSourceStats[]> {
    return [...this.sources.values()].map((source) => {
      const pages = [...this.pages.values()].filter(
        (page) => page.sourceId === source.sourceId && page.tombstonedAt === null
      );
      const pageIds = new Set(pages.map((page) => page.id));
      const chunkCount = [...this.chunks.values()].filter((chunk) => pageIds.has(chunk.pageId)).length;

      return {
        sourceId: source.sourceId,
        displayName: source.displayName,
        enabled: source.enabled,
        allowedUrlPatterns: source.allowedUrlPatterns,
        defaultTtlSeconds: source.defaultTtlSeconds,
        pageCount: pages.length,
        chunkCount
      };
    });
  }

  async getPageByCanonicalUrl(sourceId: string, canonicalUrl: string): Promise<DocPage | null> {
    const pageId = this.pagesByCanonicalUrl.get(key(sourceId, canonicalUrl));
    const page = pageId === undefined ? null : this.pages.get(pageId) ?? null;
    return page === null ? null : summarizePage(page);
  }

  async getPageByUrl(input: { readonly sourceId: string; readonly url: string }): Promise<StoredDocsPage | null> {
    const pageId = this.pagesByCanonicalUrl.get(key(input.sourceId, input.url));

    if (pageId !== undefined) {
      return this.pages.get(pageId) ?? null;
    }

    return (
      [...this.pages.values()].find((page) => page.sourceId === input.sourceId && page.url === input.url) ?? null
    );
  }

  async getPageById(input: { readonly sourceId: string; readonly pageId: number }): Promise<StoredDocsPage | null> {
    const page = this.pages.get(input.pageId) ?? null;
    return page?.sourceId === input.sourceId ? page : null;
  }

  async upsertPage(input: UpsertPageInput): Promise<DocPage> {
    const existingId = this.pagesByCanonicalUrl.get(key(input.sourceId, input.canonicalUrl));
    const id = existingId ?? this.pageSeq++;
    const page: StoredDocsPage = {
      id,
      sourceId: input.sourceId,
      url: input.url,
      canonicalUrl: input.canonicalUrl,
      title: input.title,
      content: input.content,
      contentHash: input.contentHash,
      fetchedAt: input.fetchedAt,
      indexedAt: input.indexedAt,
      expiresAt: input.expiresAt ?? null,
      tombstonedAt: null,
      tombstoneReason: null
    };

    this.pages.set(id, page);
    this.pagesByCanonicalUrl.set(key(input.sourceId, input.canonicalUrl), id);
    return summarizePage(page);
  }

  async insertChunks(input: InsertChunksInput): Promise<DocChunk[]> {
    const inserted: DocChunk[] = [];
    const chunkIds: number[] = [];

    for (const chunk of input.chunks) {
      const stored: DocChunk = {
        id: this.chunkSeq++,
        sourceId: input.sourceId,
        pageId: input.pageId,
        url: chunk.url,
        title: chunk.title,
        headingPath: chunk.headingPath,
        chunkIndex: chunk.chunkIndex,
        content: chunk.content,
        contentHash: chunk.contentHash,
        tokenEstimate: chunk.tokenEstimate
      };
      this.chunks.set(stored.id, stored);
      chunkIds.push(stored.id);
      inserted.push(stored);
    }

    this.chunksByPageId.set(input.pageId, chunkIds);
    return inserted;
  }

  async getChunksForPage(pageId: number): Promise<StoredDocsChunk[]> {
    return (this.chunksByPageId.get(pageId) ?? [])
      .map((chunkId) => this.chunks.get(chunkId))
      .filter((chunk): chunk is DocChunk => chunk !== undefined)
      .map((chunk) => this.toStoredChunk(chunk));
  }

  async getChunkById(input: { readonly sourceId: string; readonly chunkId: number }): Promise<StoredDocsChunk | null> {
    const chunk = this.chunks.get(input.chunkId);
    const page = chunk === undefined ? undefined : this.pages.get(chunk.pageId);

    if (chunk === undefined || chunk.sourceId !== input.sourceId || page?.tombstonedAt !== null) {
      return null;
    }

    return this.toStoredChunk(chunk);
  }

  async deleteChunksForPage(pageId: number): Promise<number> {
    const chunkIds = this.chunksByPageId.get(pageId) ?? [];

    for (const chunkId of chunkIds) {
      this.chunks.delete(chunkId);
      for (const embeddingKey of [...this.embeddings.keys()]) {
        if (embeddingKey.startsWith(`${chunkId}\0`)) {
          this.embeddings.delete(embeddingKey);
        }
      }
    }

    this.chunksByPageId.delete(pageId);
    return chunkIds.length;
  }

  async getEmbeddingForChunk(input: {
    readonly chunkId: number;
    readonly provider: string;
    readonly model: string;
    readonly embeddingVersion: string;
  }): Promise<DocEmbedding | null> {
    return this.embeddings.get(key(input.chunkId.toString(), `${input.provider}\0${input.model}\0${input.embeddingVersion}`)) ?? null;
  }

  async insertEmbedding(input: InsertEmbeddingInput): Promise<DocEmbedding> {
    const embedding: DocEmbedding = {
      id: this.embeddingSeq++,
      chunkId: input.chunkId,
      provider: input.provider,
      model: input.model,
      embeddingVersion: input.embeddingVersion,
      dimensions: input.dimensions
    };
    this.embeddings.set(key(input.chunkId.toString(), `${input.provider}\0${input.model}\0${input.embeddingVersion}`), embedding);
    return embedding;
  }

  async createRefreshJob(input: CreateRefreshJobInput): Promise<RefreshJob> {
    const now = generatedAt;
    const job: RefreshJob = {
      id: this.refreshJobSeq++,
      sourceId: input.sourceId,
      url: input.url ?? null,
      jobType: input.jobType,
      reason: input.reason,
      status: "queued",
      priority: input.priority,
      runAfter: input.runAfter ?? now,
      attemptCount: 0,
      lastError: null,
      createdAt: now,
      updatedAt: now,
      finishedAt: null
    };
    this.refreshJobs.push(job);
    return job;
  }

  async findPendingRefreshJob(input: {
    readonly sourceId: string;
    readonly url?: string;
    readonly jobType: RefreshJob["jobType"];
  }): Promise<RefreshJob | null> {
    return (
      this.refreshJobs.find(
        (job) =>
          job.sourceId === input.sourceId &&
          (job.url ?? "") === (input.url ?? "") &&
          job.jobType === input.jobType &&
          (job.status === "queued" || job.status === "running")
      ) ?? null
    );
  }

  async countPendingRefreshJobs(input: { readonly sourceId?: string } = {}): Promise<number> {
    return this.refreshJobs.filter(
      (job) =>
        (job.status === "queued" || job.status === "running") &&
        (input.sourceId === undefined || job.sourceId === input.sourceId)
    ).length;
  }

  async recordRetrievalEvent(input: RecordRetrievalEventInput): Promise<RetrievalEvent> {
    const event: RetrievalEvent = {
      id: this.retrievalEventSeq++,
      sourceId: input.sourceId,
      queryHash: input.queryHash
    };
    this.retrievalEvents.push(event);
    return event;
  }

  makePageStale(url: string): void {
    const pageId = this.pagesByCanonicalUrl.get(key("bun", url));

    if (pageId === undefined) {
      throw new Error(`Expected page for ${url}.`);
    }

    const page = this.pages.get(pageId);

    if (page === undefined) {
      throw new Error(`Expected page ${pageId}.`);
    }

    this.pages.set(pageId, {
      ...page,
      fetchedAt: staleFetchedAt,
      indexedAt: staleFetchedAt,
      expiresAt: staleFetchedAt
    });
  }

  keywordResults(input: KeywordSearchInput): KeywordRetrievalResultItem[] {
    return this.searchChunks(input.sourceId, input.query, input.limit ?? 5).map((result) => ({
      ...result,
      score: result.keywordScore,
      vectorScore: 0,
      rerankScore: 0
    }));
  }

  vectorResults(input: VectorSearchInput): VectorRetrievalResultItem[] {
    return this.searchChunks(input.sourceId, input.query, input.limit ?? 5).map((result) => ({
      ...result,
      score: result.vectorScore,
      keywordScore: 0,
      rerankScore: 0
    }));
  }

  private toStoredChunk(chunk: DocChunk): StoredDocsChunk {
    const chunkIds = this.chunksByPageId.get(chunk.pageId) ?? [];
    const position = chunkIds.indexOf(chunk.id);

    return {
      ...chunk,
      previousChunkId: position > 0 ? chunkIds[position - 1] ?? null : null,
      nextChunkId: position >= 0 && position < chunkIds.length - 1 ? chunkIds[position + 1] ?? null : null
    };
  }

  private searchChunks(sourceId: string, query: string, limit: number) {
    const normalizedQuery = query.trim().toLowerCase();
    const terms = normalizedQuery.split(/\s+/u).filter((term) => term.length > 0);

    return [...this.chunks.values()]
      .map((chunk) => {
        const page = this.pages.get(chunk.pageId);
        const haystack = `${chunk.title} ${chunk.headingPath.join(" ")} ${chunk.content}`.toLowerCase();
        const exact = normalizedQuery.length > 0 && haystack.includes(normalizedQuery);
        const termMatches = terms.filter((term) => haystack.includes(term)).length;
        const keywordScore = exact ? 3 : termMatches;

        if (chunk.sourceId !== sourceId || page === undefined || page.tombstonedAt !== null || keywordScore === 0) {
          return null;
        }

        return {
          chunkId: chunk.id,
          pageId: chunk.pageId,
          title: chunk.title,
          url: chunk.url,
          headingPath: chunk.headingPath,
          snippet: chunk.content.replace(/\s+/gu, " ").slice(0, 240),
          keywordScore,
          vectorScore: exact ? 0.9 : 0.25,
          fetchedAt: page.fetchedAt,
          indexedAt: page.indexedAt,
          contentHash: chunk.contentHash
        };
      })
      .filter((result): result is NonNullable<typeof result> => result !== null)
      .sort((left, right) => right.keywordScore - left.keywordScore || left.chunkId - right.chunkId)
      .slice(0, limit);
  }
}

class InMemoryKeywordRetrieval {
  constructor(private readonly store: InMemoryRemoteDocsStore) {}

  async search(input: KeywordSearchInput): Promise<KeywordSearchResult> {
    const query = input.query.trim();
    const limit = input.limit ?? 5;

    return {
      sourceId: input.sourceId,
      query,
      limit,
      results: this.store.keywordResults({ ...input, query, limit })
    };
  }
}

class InMemoryVectorRetrieval {
  constructor(
    private readonly store: InMemoryRemoteDocsStore,
    private readonly embedding: EmbeddingProviderMetadata
  ) {}

  async search(input: VectorSearchInput): Promise<VectorSearchResult> {
    const query = input.query.trim();
    const limit = input.limit ?? 5;

    return {
      ok: true,
      sourceId: input.sourceId,
      query,
      limit,
      embedding: this.embedding,
      results: this.store.vectorResults({ ...input, query, limit })
    };
  }
}

function mcpJsonHeaders(): Record<string, string> {
  return {
    authorization: `Bearer ${bearerToken}`,
    accept: "application/json, text/event-stream",
    "content-type": "application/json"
  };
}

async function postMcp(app: ReturnType<typeof createRemoteHttpApp>, body: unknown): Promise<Response> {
  return app.request("/mcp", {
    method: "POST",
    headers: mcpJsonHeaders(),
    body: JSON.stringify(body)
  });
}

async function initialize(app: ReturnType<typeof createRemoteHttpApp>): Promise<void> {
  const response = await postMcp(app, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "remote-docs-http-e2e", version: "0.0.0" }
    }
  });

  expect(response.status).toBe(200);
  await response.json();
  await postMcp(app, {
    jsonrpc: "2.0",
    method: "notifications/initialized",
    params: {}
  });
}

async function listTools(app: ReturnType<typeof createRemoteHttpApp>): Promise<string[]> {
  const response = await postMcp(app, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
    params: {}
  });
  const body = (await response.json()) as McpToolListResponse;

  expect(response.status).toBe(200);
  return body.result.tools.map((tool) => tool.name);
}

function structuredContent<T>(body: McpToolCallResponse<T>): T {
  if (body.result.structuredContent !== undefined) {
    return body.result.structuredContent;
  }

  const text = body.result.content?.[0]?.text;

  if (text === undefined) {
    throw new Error("Expected MCP tool result structured content or text content.");
  }

  return JSON.parse(text) as T;
}

async function callTool<T>(app: ReturnType<typeof createRemoteHttpApp>, id: number, name: string, args: unknown): Promise<T> {
  const response = await postMcp(app, {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name, arguments: args }
  });
  const body = (await response.json()) as McpToolCallResponse<T>;

  expect(response.status).toBe(200);
  expect(body.error).toBeUndefined();
  return structuredContent(body);
}

async function readJsonResource<T>(app: ReturnType<typeof createRemoteHttpApp>, id: number, uri: string): Promise<T> {
  const response = await postMcp(app, {
    jsonrpc: "2.0",
    id,
    method: "resources/read",
    params: { uri }
  });
  const body = (await response.json()) as {
    readonly result: { readonly contents: Array<{ readonly text: string }> };
    readonly error?: unknown;
  };

  expect(response.status).toBe(200);
  expect(body.error).toBeUndefined();
  return JSON.parse(body.result.contents[0]?.text ?? "null") as T;
}

async function createHarness() {
  const store = new InMemoryRemoteDocsStore();
  const embeddingProvider = new FakeEmbeddingProvider({ dimensions: 16 });
  const discoveryClient = new BunDocsDiscoveryClient({
    fetchImpl: mockedBunDocsFetch,
    now: () => fetchedAt
  });
  const pipeline = new BunDocsIngestionPipeline({
    storage: store as never,
    discoveryClient,
    embeddingProvider,
    now: () => indexedAt
  });
  const ingestion = await pipeline.ingestFromIndex({ limit: 1 });
  const retrieval = new HybridDocsRetrieval({
    keywordRetrieval: new InMemoryKeywordRetrieval(store),
    vectorRetrieval: new InMemoryVectorRetrieval(store, embeddingProvider.metadata),
    telemetry: store,
    defaultLimit: 5,
    maxLimit: 20,
    now: () => new Date(generatedAt)
  });
  const refreshQueue = new RefreshJobQueue({
    store,
    sourceRegistry: defaultDocsSourceRegistry,
    now: () => generatedAt,
    maxPendingJobs: 10,
    maxPendingJobsPerSource: 10
  });
  const dependencies = createServerDependencies({
    cachePath: tempCachePath(),
    fetchImpl: mockedBunDocsFetch,
    now: () => generatedAt,
    docsRetrieval: retrieval,
    docsPageStore: store,
    docsRefreshQueue: refreshQueue,
    docsSearchDefaults: { defaultLimit: 5, maxLimit: 20 }
  });
  const app = createRemoteHttpApp({
    bearerToken,
    mcpHandler: createRemoteDocsMcpHandler({ dependencies })
  });

  expect(ingestion.ok).toBe(true);
  return { app, store, ingestion };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("remote docs HTTP MCP flow", () => {
  test("authenticated docs flow searches, retrieves cited content, and enqueues stale refresh", async () => {
    const { app, store, ingestion } = await createHarness();

    await initialize(app);
    const toolNames = await listTools(app);

    expect(toolNames).toEqual(["search_docs", "get_doc_page", "search_bun_docs"]);
    expect(toolNames).not.toContain("analyze_bun_project");
    expect(toolNames).not.toContain("project_health");
    expect(ingestion.summary).toMatchObject({
      pagesDiscovered: 2,
      pagesStored: 1
    });
    expect(ingestion.summary.chunksStored).toBeGreaterThan(0);
    expect(ingestion.summary.embeddingsCreated).toBe(ingestion.summary.chunksStored);

    const searchResult = await callTool<SearchDocsStructuredResult>(app, 3, "search_docs", {
      query: "Bun.serve",
      mode: "hybrid"
    });

    expect(searchResult).toMatchObject({
      ok: true,
      query: "Bun.serve",
      sourceId: "bun",
      mode: "hybrid",
      freshness: "fresh",
      confidence: "high",
      refreshQueued: false
    });
    expect(searchResult.retrieval).toMatchObject({
      mode: "hybrid",
      keywordAttempted: true,
      vectorAttempted: true,
      mergedResultCount: 1
    });
    expect(searchResult.results[0]).toMatchObject({
      title: "HTTP server",
      url: "https://bun.com/docs/runtime/http-server",
      keywordScore: 3,
      vectorScore: 0.9
    });
    expect(searchResult.results[0]?.snippet).toContain("Bun.serve");
    expect(searchResult.sources).toMatchObject([
      {
        title: "HTTP server",
        url: "https://bun.com/docs/runtime/http-server",
        contentHash: searchResult.results[0]?.contentHash
      }
    ]);

    const pageResult = await callTool<GetDocPageStructuredResult>(app, 4, "get_doc_page", {
      url: searchResult.results[0]?.url
    });

    expect(pageResult).toMatchObject({
      ok: true,
      url: "https://bun.com/docs/runtime/http-server",
      title: "HTTP server",
      freshness: "fresh"
    });
    expect(pageResult.content).toContain("Bun.serve");
    expect(pageResult.chunks[0]?.content).toContain("Bun.serve");
    expect(pageResult.sources[0]).toMatchObject({
      url: "https://bun.com/docs/runtime/http-server"
    });

    const chunkResult = await readJsonResource<DocsChunkResource>(
      app,
      5,
      `docs://chunk/bun/${searchResult.results[0]?.chunkId}`
    );

    expect(chunkResult).toMatchObject({
      ok: true,
      chunkId: searchResult.results[0]?.chunkId,
      pageId: searchResult.results[0]?.pageId,
      title: "HTTP server"
    });
    expect(chunkResult.content).toContain("Bun.serve");

    store.makePageStale("https://bun.com/docs/runtime/http-server");
    const staleResult = await callTool<SearchDocsStructuredResult>(app, 6, "search_docs", {
      query: "Bun.serve",
      mode: "hybrid"
    });

    expect(staleResult.results).toHaveLength(1);
    expect(staleResult).toMatchObject({
      ok: true,
      freshness: "stale",
      confidence: "medium",
      refreshQueued: true,
      refreshReason: "stale_content"
    });
    expect(store.refreshJobs).toHaveLength(1);
    expect(store.refreshJobs[0]).toMatchObject({
      sourceId: "bun",
      url: "https://bun.com/docs/runtime/http-server",
      jobType: "page",
      reason: "stale_content",
      status: "queued"
    });
  });

  test("unauthenticated MCP docs requests are rejected before tool handling", async () => {
    const { app, store } = await createHarness();

    const response = await app.request("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
    });

    expect(response.status).toBe(401);
    expect(store.retrievalEvents).toHaveLength(0);
    expect(store.refreshJobs).toHaveLength(0);
  });
});
