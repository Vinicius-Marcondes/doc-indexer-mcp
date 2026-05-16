import { and, asc, desc, eq, inArray, isNull, or, sql as drizzleSql } from "drizzle-orm";
import type { SqlClient } from "./database";
import { createDrizzleDatabase, type RemoteDocsDrizzleDatabase } from "./drizzle";
import {
  docChunks,
  docPages,
  docRefreshJobs,
  docRetrievalEvents,
  docSources
} from "./schema";

export interface StoredDocsSourceStats {
  readonly sourceId: string;
  readonly displayName: string;
  readonly enabled: boolean;
  readonly allowedUrlPatterns: readonly string[];
  readonly defaultTtlSeconds: number;
  readonly pageCount: number;
  readonly chunkCount: number;
}

export interface StoredDocsPage {
  readonly id: number;
  readonly sourceId: string;
  readonly url: string;
  readonly canonicalUrl: string;
  readonly title: string;
  readonly content: string;
  readonly contentHash: string;
  readonly fetchedAt: string;
  readonly indexedAt: string;
  readonly expiresAt: string | null;
  readonly tombstonedAt: string | null;
  readonly tombstoneReason: string | null;
}

export interface StoredDocsChunk {
  readonly id: number;
  readonly sourceId: string;
  readonly pageId: number;
  readonly url: string;
  readonly title: string;
  readonly headingPath: readonly string[];
  readonly chunkIndex: number;
  readonly content: string;
  readonly contentHash: string;
  readonly tokenEstimate: number;
  readonly previousChunkId: number | null;
  readonly nextChunkId: number | null;
}

export interface DocSource {
  readonly id: number;
  readonly sourceId: string;
  readonly displayName: string;
  readonly enabled: boolean;
  readonly allowedUrlPatterns: readonly string[];
  readonly defaultTtlSeconds: number;
}

export interface UpsertSourceInput {
  readonly sourceId: string;
  readonly displayName: string;
  readonly enabled: boolean;
  readonly allowedUrlPatterns: readonly string[];
  readonly defaultTtlSeconds: number;
}

export interface DocPage {
  readonly id: number;
  readonly sourceId: string;
  readonly url: string;
  readonly canonicalUrl: string;
  readonly title: string;
  readonly contentHash: string;
}

export interface UpsertPageInput {
  readonly sourceId: string;
  readonly url: string;
  readonly canonicalUrl: string;
  readonly title: string;
  readonly content: string;
  readonly contentHash: string;
  readonly httpStatus: number;
  readonly fetchedAt: string;
  readonly indexedAt: string;
  readonly expiresAt?: string;
}

export interface DocChunk {
  readonly id: number;
  readonly sourceId: string;
  readonly pageId: number;
  readonly url: string;
  readonly title: string;
  readonly headingPath: readonly string[];
  readonly chunkIndex: number;
  readonly content: string;
  readonly contentHash: string;
  readonly tokenEstimate: number;
}

export interface InsertChunkInput {
  readonly url: string;
  readonly title: string;
  readonly headingPath: readonly string[];
  readonly chunkIndex: number;
  readonly content: string;
  readonly contentHash: string;
  readonly tokenEstimate: number;
}

export interface InsertChunksInput {
  readonly sourceId: string;
  readonly pageId: number;
  readonly chunks: readonly InsertChunkInput[];
}

export interface DocEmbedding {
  readonly id: number;
  readonly chunkId: number;
  readonly provider: string;
  readonly model: string;
  readonly embeddingVersion: string;
  readonly dimensions: number;
}

export interface InsertEmbeddingInput {
  readonly chunkId: number;
  readonly provider: string;
  readonly model: string;
  readonly embeddingVersion: string;
  readonly dimensions: number;
  readonly embedding: readonly number[];
}

export type RefreshJobType = "source_index" | "page" | "embedding" | "tombstone_check";
export type RefreshJobReason = "scheduled" | "missing_content" | "stale_content" | "low_confidence" | "manual";
export type RefreshJobStatus = "queued" | "running" | "succeeded" | "failed" | "deduplicated";

export interface RefreshJob {
  readonly id: number;
  readonly sourceId: string;
  readonly url: string | null;
  readonly jobType: RefreshJobType;
  readonly reason: RefreshJobReason;
  readonly status: RefreshJobStatus;
  readonly priority: number;
  readonly runAfter: string;
  readonly attemptCount: number;
  readonly lastError: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly finishedAt: string | null;
}

export interface CreateRefreshJobInput {
  readonly sourceId: string;
  readonly url?: string;
  readonly jobType: RefreshJobType;
  readonly reason: RefreshJobReason;
  readonly priority: number;
  readonly runAfter?: string;
}

export type RetrievalMode = "hybrid" | "keyword" | "semantic";
export type RetrievalConfidence = "high" | "medium" | "low";

export interface RetrievalEvent {
  readonly id: number;
  readonly sourceId: string;
  readonly queryHash: string;
}

export interface RecordRetrievalEventInput {
  readonly sourceId: string;
  readonly queryHash: string;
  readonly mode: RetrievalMode;
  readonly resultCount: number;
  readonly confidence: RetrievalConfidence;
  readonly lowConfidence: boolean;
  readonly refreshQueued: boolean;
}

interface PageDetailRow extends Record<string, unknown> {
  readonly id: number;
  readonly source_id: string;
  readonly url: string;
  readonly canonical_url: string;
  readonly title: string;
  readonly content: string;
  readonly content_hash: string;
  readonly fetched_at: string;
  readonly indexed_at: string;
  readonly expires_at: string | null;
  readonly tombstoned_at: string | null;
  readonly tombstone_reason: string | null;
}

interface PageDetailDrizzleRow {
  readonly id: number;
  readonly sourceId: string;
  readonly url: string;
  readonly canonicalUrl: string;
  readonly title: string;
  readonly content: string;
  readonly contentHash: string;
  readonly fetchedAt: string;
  readonly indexedAt: string;
  readonly expiresAt: string | null;
  readonly tombstonedAt: string | null;
  readonly tombstoneReason: string | null;
}

interface ChunkDetailRow extends Record<string, unknown> {
  readonly id: number;
  readonly source_id: string;
  readonly page_id: number;
  readonly url: string;
  readonly title: string;
  readonly heading_path: string[];
  readonly chunk_index: number;
  readonly content: string;
  readonly content_hash: string;
  readonly token_estimate: number;
  readonly previous_chunk_id: number | null;
  readonly next_chunk_id: number | null;
}

interface SourceStatsRow extends Record<string, unknown> {
  readonly source_id: string;
  readonly display_name: string;
  readonly enabled: boolean;
  readonly allowed_url_patterns: string[];
  readonly default_ttl_seconds: number;
  readonly page_count: number;
  readonly chunk_count: number;
}

interface EmbeddingRow extends Record<string, unknown> {
  readonly id: number;
  readonly chunk_id: number;
  readonly provider: string;
  readonly model: string;
  readonly embedding_version: string;
  readonly dimensions: number;
}

interface RefreshJobRow extends Record<string, unknown> {
  readonly id: number;
  readonly source_id: string;
  readonly url: string | null;
  readonly job_type: RefreshJobType;
  readonly reason: RefreshJobReason;
  readonly status: RefreshJobStatus;
  readonly priority: number;
  readonly run_after: string;
  readonly attempt_count: number;
  readonly last_error: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly finished_at: string | null;
}

function requiredRow<T>(rows: readonly T[], context: string): T {
  const row = rows[0];

  if (row === undefined) {
    throw new Error(`Expected row for ${context}.`);
  }

  return row;
}

function toIsoString(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? value : new Date(timestamp).toISOString();
}

function mapPageDetail(row: PageDetailRow): StoredDocsPage {
  return {
    id: row.id,
    sourceId: row.source_id,
    url: row.url,
    canonicalUrl: row.canonical_url,
    title: row.title,
    content: row.content,
    contentHash: row.content_hash,
    fetchedAt: toIsoString(row.fetched_at) ?? row.fetched_at,
    indexedAt: toIsoString(row.indexed_at) ?? row.indexed_at,
    expiresAt: toIsoString(row.expires_at),
    tombstonedAt: toIsoString(row.tombstoned_at),
    tombstoneReason: row.tombstone_reason
  };
}

function mapDrizzlePageDetail(row: PageDetailDrizzleRow): StoredDocsPage {
  return {
    id: row.id,
    sourceId: row.sourceId,
    url: row.url,
    canonicalUrl: row.canonicalUrl,
    title: row.title,
    content: row.content,
    contentHash: row.contentHash,
    fetchedAt: toIsoString(row.fetchedAt) ?? row.fetchedAt,
    indexedAt: toIsoString(row.indexedAt) ?? row.indexedAt,
    expiresAt: toIsoString(row.expiresAt),
    tombstonedAt: toIsoString(row.tombstonedAt),
    tombstoneReason: row.tombstoneReason
  };
}

function mapChunkDetail(row: ChunkDetailRow): StoredDocsChunk {
  return {
    id: row.id,
    sourceId: row.source_id,
    pageId: row.page_id,
    url: row.url,
    title: row.title,
    headingPath: row.heading_path,
    chunkIndex: row.chunk_index,
    content: row.content,
    contentHash: row.content_hash,
    tokenEstimate: row.token_estimate,
    previousChunkId: row.previous_chunk_id === null ? null : Number(row.previous_chunk_id),
    nextChunkId: row.next_chunk_id === null ? null : Number(row.next_chunk_id)
  };
}

function mapSourceStats(row: SourceStatsRow): StoredDocsSourceStats {
  return {
    sourceId: row.source_id,
    displayName: row.display_name,
    enabled: row.enabled,
    allowedUrlPatterns: row.allowed_url_patterns,
    defaultTtlSeconds: row.default_ttl_seconds,
    pageCount: Number(row.page_count),
    chunkCount: Number(row.chunk_count)
  };
}

function mapEmbedding(row: EmbeddingRow): DocEmbedding {
  return {
    id: row.id,
    chunkId: row.chunk_id,
    provider: row.provider,
    model: row.model,
    embeddingVersion: row.embedding_version,
    dimensions: row.dimensions
  };
}

function mapRefreshJob(row: RefreshJobRow): RefreshJob {
  return {
    id: row.id,
    sourceId: row.source_id,
    url: row.url,
    jobType: row.job_type,
    reason: row.reason,
    status: row.status,
    priority: row.priority,
    runAfter: toIsoString(row.run_after) ?? row.run_after,
    attemptCount: row.attempt_count,
    lastError: row.last_error,
    createdAt: toIsoString(row.created_at) ?? row.created_at,
    updatedAt: toIsoString(row.updated_at) ?? row.updated_at,
    finishedAt: row.finished_at === null ? null : toIsoString(row.finished_at) ?? row.finished_at
  };
}

function normalizeRefreshJob(row: RefreshJob): RefreshJob {
  return {
    ...row,
    runAfter: toIsoString(row.runAfter) ?? row.runAfter,
    createdAt: toIsoString(row.createdAt) ?? row.createdAt,
    updatedAt: toIsoString(row.updatedAt) ?? row.updatedAt,
    finishedAt: row.finishedAt === null ? null : toIsoString(row.finishedAt) ?? row.finishedAt
  };
}

function validateEmbedding(input: InsertEmbeddingInput): void {
  if (input.embedding.length !== input.dimensions) {
    throw new Error(`Embedding length ${input.embedding.length} does not match dimensions ${input.dimensions}.`);
  }

  if (input.dimensions !== 1536) {
    throw new Error("V1 schema stores 1536-dimension embeddings.");
  }

  if (input.embedding.some((value) => !Number.isFinite(value))) {
    throw new Error("Embedding values must be finite numbers.");
  }
}

function validateExistingEmbeddingCompatibility(input: InsertEmbeddingInput, existing: DocEmbedding): void {
  if (existing.chunkId !== input.chunkId) {
    throw new Error("Existing embedding chunk does not match requested chunk.");
  }

  if (existing.provider !== input.provider || existing.model !== input.model || existing.embeddingVersion !== input.embeddingVersion) {
    throw new Error("Existing embedding metadata does not match requested embedding.");
  }

  if (existing.dimensions !== input.dimensions) {
    throw new Error(`Existing embedding dimensions ${existing.dimensions} do not match requested dimensions ${input.dimensions}.`);
  }
}

export class RemoteDocsStorage {
  private db: RemoteDocsDrizzleDatabase | null = null;

  constructor(private readonly sql: SqlClient, db?: RemoteDocsDrizzleDatabase) {
    this.db = db ?? null;
  }

  private drizzle(): RemoteDocsDrizzleDatabase {
    this.db ??= createDrizzleDatabase(this.sql);
    return this.db;
  }

  async upsertSource(input: UpsertSourceInput): Promise<DocSource> {
    const rows = await this.drizzle()
      .insert(docSources)
      .values({
        sourceId: input.sourceId,
        displayName: input.displayName,
        enabled: input.enabled,
        allowedUrlPatterns: input.allowedUrlPatterns,
        defaultTtlSeconds: input.defaultTtlSeconds
      })
      .onConflictDoUpdate({
        target: docSources.sourceId,
        set: {
          displayName: input.displayName,
          enabled: input.enabled,
          allowedUrlPatterns: input.allowedUrlPatterns,
          defaultTtlSeconds: input.defaultTtlSeconds,
          updatedAt: drizzleSql`now()`
        }
      })
      .returning({
        id: docSources.id,
        sourceId: docSources.sourceId,
        displayName: docSources.displayName,
        enabled: docSources.enabled,
        allowedUrlPatterns: docSources.allowedUrlPatterns,
        defaultTtlSeconds: docSources.defaultTtlSeconds
      });

    return requiredRow(rows, "upsertSource");
  }

  async getSource(sourceId: string): Promise<DocSource | null> {
    const rows = await this.drizzle()
      .select({
        id: docSources.id,
        sourceId: docSources.sourceId,
        displayName: docSources.displayName,
        enabled: docSources.enabled,
        allowedUrlPatterns: docSources.allowedUrlPatterns,
        defaultTtlSeconds: docSources.defaultTtlSeconds
      })
      .from(docSources)
      .where(eq(docSources.sourceId, sourceId))
      .limit(1);

    return rows[0] ?? null;
  }

  async listSourceStats(): Promise<StoredDocsSourceStats[]> {
    const rows = await this.sql<SourceStatsRow[]>`
      select
        s.source_id,
        s.display_name,
        s.enabled,
        s.allowed_url_patterns,
        s.default_ttl_seconds,
        count(distinct p.id)::integer as page_count,
        count(c.id)::integer as chunk_count
      from doc_sources s
      left join doc_pages p on p.source_id = s.source_id and p.tombstoned_at is null
      left join doc_chunks c on c.page_id = p.id
      group by s.source_id, s.display_name, s.enabled, s.allowed_url_patterns, s.default_ttl_seconds
      order by s.source_id
    `;

    return rows.map(mapSourceStats);
  }

  async getPageByCanonicalUrl(sourceId: string, canonicalUrl: string): Promise<DocPage | null> {
    const rows = await this.drizzle()
      .select({
        id: docPages.id,
        sourceId: docPages.sourceId,
        url: docPages.url,
        canonicalUrl: docPages.canonicalUrl,
        title: docPages.title,
        contentHash: docPages.contentHash
      })
      .from(docPages)
      .where(and(eq(docPages.sourceId, sourceId), eq(docPages.canonicalUrl, canonicalUrl)))
      .limit(1);

    return rows[0] ?? null;
  }

  async getPageByUrl(input: { readonly sourceId: string; readonly url: string }): Promise<StoredDocsPage | null> {
    const rows = await this.drizzle()
      .select({
        id: docPages.id,
        sourceId: docPages.sourceId,
        url: docPages.url,
        canonicalUrl: docPages.canonicalUrl,
        title: docPages.title,
        content: docPages.content,
        contentHash: docPages.contentHash,
        fetchedAt: docPages.fetchedAt,
        indexedAt: docPages.indexedAt,
        expiresAt: docPages.expiresAt,
        tombstonedAt: docPages.tombstonedAt,
        tombstoneReason: docPages.tombstoneReason
      })
      .from(docPages)
      .where(and(eq(docPages.sourceId, input.sourceId), or(eq(docPages.url, input.url), eq(docPages.canonicalUrl, input.url))))
      .limit(1);

    return rows[0] === undefined ? null : mapDrizzlePageDetail(rows[0]);
  }

  async markPageTombstoned(input: {
    readonly sourceId: string;
    readonly url: string;
    readonly reason: string;
    readonly now: string;
  }): Promise<StoredDocsPage | null> {
    const rows = await this.drizzle()
      .update(docPages)
      .set({
        tombstonedAt: input.now,
        tombstoneReason: input.reason,
        updatedAt: input.now
      })
      .where(and(eq(docPages.sourceId, input.sourceId), or(eq(docPages.url, input.url), eq(docPages.canonicalUrl, input.url))))
      .returning({
        id: docPages.id,
        sourceId: docPages.sourceId,
        url: docPages.url,
        canonicalUrl: docPages.canonicalUrl,
        title: docPages.title,
        content: docPages.content,
        contentHash: docPages.contentHash,
        fetchedAt: docPages.fetchedAt,
        indexedAt: docPages.indexedAt,
        expiresAt: docPages.expiresAt,
        tombstonedAt: docPages.tombstonedAt,
        tombstoneReason: docPages.tombstoneReason
      });

    return rows[0] === undefined ? null : mapDrizzlePageDetail(rows[0]);
  }

  async markSourcePagesTombstoned(input: {
    readonly sourceId: string;
    readonly reason: string;
    readonly now: string;
  }): Promise<number> {
    const rows = await this.drizzle()
      .update(docPages)
      .set({
        tombstonedAt: input.now,
        tombstoneReason: input.reason,
        updatedAt: input.now
      })
      .where(and(eq(docPages.sourceId, input.sourceId), isNull(docPages.tombstonedAt)))
      .returning({ id: docPages.id });

    return rows.length;
  }

  async recordConfirmedRemovalFailure(input: {
    readonly sourceId: string;
    readonly url: string;
    readonly status: 404 | 410;
    readonly error: unknown;
    readonly now: string;
  }): Promise<number> {
    const rows = await this.sql<Array<{ count: number }>>`
      select count(*)::integer as count
      from doc_refresh_jobs
      where source_id = ${input.sourceId}
        and coalesce(url, '') = ${input.url}
        and job_type in ('page', 'tombstone_check')
        and status = 'failed'
        and last_error is not null
        and (
          last_error like '%"status":404%'
          or last_error like '%"status":410%'
        )
    `;

    return Number(rows[0]?.count ?? 0);
  }

  async getPageById(input: { readonly sourceId: string; readonly pageId: number }): Promise<StoredDocsPage | null> {
    const rows = await this.drizzle()
      .select({
        id: docPages.id,
        sourceId: docPages.sourceId,
        url: docPages.url,
        canonicalUrl: docPages.canonicalUrl,
        title: docPages.title,
        content: docPages.content,
        contentHash: docPages.contentHash,
        fetchedAt: docPages.fetchedAt,
        indexedAt: docPages.indexedAt,
        expiresAt: docPages.expiresAt,
        tombstonedAt: docPages.tombstonedAt,
        tombstoneReason: docPages.tombstoneReason
      })
      .from(docPages)
      .where(and(eq(docPages.sourceId, input.sourceId), eq(docPages.id, input.pageId)))
      .limit(1);

    return rows[0] === undefined ? null : mapDrizzlePageDetail(rows[0]);
  }

  async upsertPage(input: UpsertPageInput): Promise<DocPage> {
    const rows = await this.drizzle()
      .insert(docPages)
      .values({
        sourceId: input.sourceId,
        url: input.url,
        canonicalUrl: input.canonicalUrl,
        title: input.title,
        content: input.content,
        contentHash: input.contentHash,
        httpStatus: input.httpStatus,
        fetchedAt: input.fetchedAt,
        indexedAt: input.indexedAt,
        expiresAt: input.expiresAt ?? null
      })
      .onConflictDoUpdate({
        target: [docPages.sourceId, docPages.canonicalUrl],
        set: {
          url: input.url,
          title: input.title,
          content: input.content,
          contentHash: input.contentHash,
          httpStatus: input.httpStatus,
          fetchedAt: input.fetchedAt,
          indexedAt: input.indexedAt,
          expiresAt: input.expiresAt ?? null,
          tombstonedAt: null,
          tombstoneReason: null,
          updatedAt: drizzleSql`now()`
        }
      })
      .returning({
        id: docPages.id,
        sourceId: docPages.sourceId,
        url: docPages.url,
        canonicalUrl: docPages.canonicalUrl,
        title: docPages.title,
        contentHash: docPages.contentHash
      });

    return requiredRow(rows, "upsertPage");
  }

  async insertChunks(input: InsertChunksInput): Promise<DocChunk[]> {
    return this.drizzle().transaction(async (transaction) => {
      const chunks: DocChunk[] = [];

      for (const chunk of input.chunks) {
        const rows = await transaction
          .insert(docChunks)
          .values({
            sourceId: input.sourceId,
            pageId: input.pageId,
            url: chunk.url,
            title: chunk.title,
            headingPath: [...chunk.headingPath],
            chunkIndex: chunk.chunkIndex,
            content: chunk.content,
            contentHash: chunk.contentHash,
            tokenEstimate: chunk.tokenEstimate
          })
          .onConflictDoUpdate({
            target: [docChunks.sourceId, docChunks.pageId, docChunks.contentHash],
            set: {
              url: chunk.url,
              title: chunk.title,
              headingPath: [...chunk.headingPath],
              chunkIndex: chunk.chunkIndex,
              content: chunk.content,
              tokenEstimate: chunk.tokenEstimate,
              updatedAt: drizzleSql`now()`
            }
          })
          .returning({
            id: docChunks.id,
            sourceId: docChunks.sourceId,
            pageId: docChunks.pageId,
            url: docChunks.url,
            title: docChunks.title,
            headingPath: docChunks.headingPath,
            chunkIndex: docChunks.chunkIndex,
            content: docChunks.content,
            contentHash: docChunks.contentHash,
            tokenEstimate: docChunks.tokenEstimate
          });

        chunks.push(requiredRow(rows, "insertChunks"));
      }

      return chunks;
    });
  }

  async getChunksForPage(pageId: number): Promise<StoredDocsChunk[]> {
    const rows = await this.sql<ChunkDetailRow[]>`
      select
        c.id,
        c.source_id,
        c.page_id,
        c.url,
        c.title,
        c.heading_path,
        c.chunk_index,
        c.content,
        c.content_hash,
        c.token_estimate,
        prev.id as previous_chunk_id,
        next.id as next_chunk_id
      from doc_chunks c
      left join doc_chunks prev on prev.page_id = c.page_id and prev.chunk_index = c.chunk_index - 1
      left join doc_chunks next on next.page_id = c.page_id and next.chunk_index = c.chunk_index + 1
      where c.page_id = ${pageId}
      order by c.chunk_index
    `;

    return rows.map(mapChunkDetail);
  }

  async getChunkById(input: { readonly sourceId: string; readonly chunkId: number }): Promise<StoredDocsChunk | null> {
    const rows = await this.sql<ChunkDetailRow[]>`
      select
        c.id,
        c.source_id,
        c.page_id,
        c.url,
        c.title,
        c.heading_path,
        c.chunk_index,
        c.content,
        c.content_hash,
        c.token_estimate,
        prev.id as previous_chunk_id,
        next.id as next_chunk_id
      from doc_chunks c
      join doc_pages p on p.id = c.page_id
      left join doc_chunks prev on prev.page_id = c.page_id and prev.chunk_index = c.chunk_index - 1
      left join doc_chunks next on next.page_id = c.page_id and next.chunk_index = c.chunk_index + 1
      where c.source_id = ${input.sourceId}
        and c.id = ${input.chunkId}
        and p.tombstoned_at is null
    `;

    return rows[0] === undefined ? null : mapChunkDetail(rows[0]);
  }

  async deleteChunksForPage(pageId: number): Promise<number> {
    const rows = await this.drizzle().delete(docChunks).where(eq(docChunks.pageId, pageId)).returning({ id: docChunks.id });

    return rows.length;
  }

  async getEmbeddingForChunk(input: {
    readonly chunkId: number;
    readonly provider: string;
    readonly model: string;
    readonly embeddingVersion: string;
  }): Promise<DocEmbedding | null> {
    const rows = await this.sql<EmbeddingRow[]>`
      select id, chunk_id, provider, model, embedding_version, dimensions
      from doc_embeddings
      where chunk_id = ${input.chunkId}
        and provider = ${input.provider}
        and model = ${input.model}
        and embedding_version = ${input.embeddingVersion}
    `;

    return rows[0] === undefined ? null : mapEmbedding(rows[0]);
  }

  async insertEmbedding(input: InsertEmbeddingInput): Promise<DocEmbedding> {
    validateEmbedding(input);
    const vectorLiteral = `[${input.embedding.join(",")}]`;
    const rows = await this.sql<EmbeddingRow[]>`
      insert into doc_embeddings (chunk_id, provider, model, embedding_version, dimensions, embedding)
      values (${input.chunkId}, ${input.provider}, ${input.model}, ${input.embeddingVersion}, ${input.dimensions}, ${vectorLiteral}::vector)
      on conflict (chunk_id, provider, model, embedding_version) do nothing
      returning id, chunk_id, provider, model, embedding_version, dimensions
    `;
    const inserted = rows[0];

    if (inserted !== undefined) {
      return mapEmbedding(inserted);
    }

    const existing = await this.getEmbeddingForChunk({
      chunkId: input.chunkId,
      provider: input.provider,
      model: input.model,
      embeddingVersion: input.embeddingVersion
    });

    if (existing === null) {
      throw new Error("Expected existing embedding after idempotent insert conflict.");
    }

    validateExistingEmbeddingCompatibility(input, existing);

    return existing;
  }

  async createRefreshJob(input: CreateRefreshJobInput): Promise<RefreshJob> {
    const rows = await this.drizzle()
      .insert(docRefreshJobs)
      .values({
        sourceId: input.sourceId,
        url: input.url ?? null,
        jobType: input.jobType,
        reason: input.reason,
        priority: input.priority,
        runAfter: input.runAfter ?? new Date().toISOString()
      })
      .returning({
        id: docRefreshJobs.id,
        sourceId: docRefreshJobs.sourceId,
        url: docRefreshJobs.url,
        jobType: docRefreshJobs.jobType,
        reason: docRefreshJobs.reason,
        status: docRefreshJobs.status,
        priority: docRefreshJobs.priority,
        runAfter: docRefreshJobs.runAfter,
        attemptCount: docRefreshJobs.attemptCount,
        lastError: docRefreshJobs.lastError,
        createdAt: docRefreshJobs.createdAt,
        updatedAt: docRefreshJobs.updatedAt,
        finishedAt: docRefreshJobs.finishedAt
      });

    return normalizeRefreshJob(requiredRow(rows, "createRefreshJob"));
  }

  async findPendingRefreshJob(input: {
    readonly sourceId: string;
    readonly url?: string;
    readonly jobType: RefreshJobType;
  }): Promise<RefreshJob | null> {
    const rows = await this.drizzle()
      .select({
        id: docRefreshJobs.id,
        sourceId: docRefreshJobs.sourceId,
        url: docRefreshJobs.url,
        jobType: docRefreshJobs.jobType,
        reason: docRefreshJobs.reason,
        status: docRefreshJobs.status,
        priority: docRefreshJobs.priority,
        runAfter: docRefreshJobs.runAfter,
        attemptCount: docRefreshJobs.attemptCount,
        lastError: docRefreshJobs.lastError,
        createdAt: docRefreshJobs.createdAt,
        updatedAt: docRefreshJobs.updatedAt,
        finishedAt: docRefreshJobs.finishedAt
      })
      .from(docRefreshJobs)
      .where(
        and(
          eq(docRefreshJobs.sourceId, input.sourceId),
          drizzleSql`coalesce(${docRefreshJobs.url}, '') = coalesce(${input.url ?? null}, '')`,
          eq(docRefreshJobs.jobType, input.jobType),
          inArray(docRefreshJobs.status, ["queued", "running"])
        )
      )
      .orderBy(desc(docRefreshJobs.priority), asc(docRefreshJobs.createdAt))
      .limit(1);

    return rows[0] === undefined ? null : normalizeRefreshJob(rows[0]);
  }

  async countPendingRefreshJobs(input: { readonly sourceId?: string } = {}): Promise<number> {
    const rows = await this.drizzle()
      .select({ count: drizzleSql<number>`count(*)::integer` })
      .from(docRefreshJobs)
      .where(
        input.sourceId === undefined
          ? inArray(docRefreshJobs.status, ["queued", "running"])
          : and(inArray(docRefreshJobs.status, ["queued", "running"]), eq(docRefreshJobs.sourceId, input.sourceId))
      );

    return Number(rows[0]?.count ?? 0);
  }

  async updateRefreshJobStatus(input: {
    readonly id: number;
    readonly status: "queued" | "running" | "succeeded" | "failed";
    readonly lastError?: string;
    readonly now?: string;
  }): Promise<RefreshJob> {
    const currentTimestamp = drizzleSql`coalesce(${input.now ?? null}::timestamptz, now())`;
    const rows = await this.drizzle()
      .update(docRefreshJobs)
      .set({
        status: input.status,
        lastError: input.lastError ?? null,
        updatedAt: currentTimestamp,
        startedAt: drizzleSql`case when ${input.status} = 'running' then ${currentTimestamp} else ${docRefreshJobs.startedAt} end`,
        finishedAt: drizzleSql`case when ${input.status} in ('succeeded', 'failed') then ${currentTimestamp} else ${docRefreshJobs.finishedAt} end`
      })
      .where(eq(docRefreshJobs.id, input.id))
      .returning({
        id: docRefreshJobs.id,
        sourceId: docRefreshJobs.sourceId,
        url: docRefreshJobs.url,
        jobType: docRefreshJobs.jobType,
        reason: docRefreshJobs.reason,
        status: docRefreshJobs.status,
        priority: docRefreshJobs.priority,
        runAfter: docRefreshJobs.runAfter,
        attemptCount: docRefreshJobs.attemptCount,
        lastError: docRefreshJobs.lastError,
        createdAt: docRefreshJobs.createdAt,
        updatedAt: docRefreshJobs.updatedAt,
        finishedAt: docRefreshJobs.finishedAt
      });

    return normalizeRefreshJob(requiredRow(rows, "updateRefreshJobStatus"));
  }

  async claimRunnableRefreshJobs(input: { readonly limit: number; readonly now: string }): Promise<RefreshJob[]> {
    const rows = await this.sql<RefreshJobRow[]>`
      update doc_refresh_jobs
      set
        status = 'running',
        attempt_count = attempt_count + 1,
        started_at = ${input.now},
        updated_at = ${input.now}
      where id in (
        select id
        from doc_refresh_jobs
        where status = 'queued'
          and run_after <= ${input.now}
        order by priority desc, created_at asc
        limit ${input.limit}
        for update skip locked
      )
      returning
        id,
        source_id,
        url,
        job_type,
        reason,
        status,
        priority,
        run_after::text as run_after,
        attempt_count,
        last_error,
        created_at::text as created_at,
        updated_at::text as updated_at,
        finished_at::text as finished_at
    `;

    return rows.map(mapRefreshJob);
  }

  async recoverStaleRunningRefreshJobs(input: {
    readonly now: string;
    readonly staleBefore: string;
    readonly limit: number;
    readonly timeoutSeconds: number;
  }): Promise<RefreshJob[]> {
    const rows = await this.sql<RefreshJobRow[]>`
      with stale as (
        select id
        from doc_refresh_jobs
        where status = 'running'
          and coalesce(started_at, updated_at) <= ${input.staleBefore}
        order by coalesce(started_at, updated_at) asc, id asc
        limit ${input.limit}
        for update skip locked
      )
      update doc_refresh_jobs
      set
        status = 'failed',
        last_error = json_build_object(
          'code',
          'internal_error',
          'message',
          'Docs refresh job exceeded running timeout.',
          'details',
          json_build_object(
            'jobId',
            doc_refresh_jobs.id,
            'sourceId',
            doc_refresh_jobs.source_id,
            'jobType',
            doc_refresh_jobs.job_type,
            'attemptCount',
            doc_refresh_jobs.attempt_count,
            'startedAt',
            coalesce(doc_refresh_jobs.started_at, doc_refresh_jobs.updated_at)::text,
            'timeoutSeconds',
            ${input.timeoutSeconds}::integer,
            'ageSeconds',
            greatest(0, floor(extract(epoch from (${input.now}::timestamptz - coalesce(doc_refresh_jobs.started_at, doc_refresh_jobs.updated_at))))::integer)
          )
        )::text,
        updated_at = ${input.now},
        finished_at = ${input.now}
      where id in (select id from stale)
      returning
        id,
        source_id,
        url,
        job_type,
        reason,
        status,
        priority,
        run_after::text as run_after,
        attempt_count,
        last_error,
        created_at::text as created_at,
        updated_at::text as updated_at,
        finished_at::text as finished_at
    `;

    return rows.map(mapRefreshJob);
  }

  async getLatestRefreshJob(input: {
    readonly sourceId: string;
    readonly jobType: RefreshJobType;
    readonly reason?: RefreshJobReason;
  }): Promise<RefreshJob | null> {
    const rows = await this.drizzle()
      .select({
        id: docRefreshJobs.id,
        sourceId: docRefreshJobs.sourceId,
        url: docRefreshJobs.url,
        jobType: docRefreshJobs.jobType,
        reason: docRefreshJobs.reason,
        status: docRefreshJobs.status,
        priority: docRefreshJobs.priority,
        runAfter: docRefreshJobs.runAfter,
        attemptCount: docRefreshJobs.attemptCount,
        lastError: docRefreshJobs.lastError,
        createdAt: docRefreshJobs.createdAt,
        updatedAt: docRefreshJobs.updatedAt,
        finishedAt: docRefreshJobs.finishedAt
      })
      .from(docRefreshJobs)
      .where(
        input.reason === undefined
          ? and(eq(docRefreshJobs.sourceId, input.sourceId), eq(docRefreshJobs.jobType, input.jobType))
          : and(eq(docRefreshJobs.sourceId, input.sourceId), eq(docRefreshJobs.jobType, input.jobType), eq(docRefreshJobs.reason, input.reason))
      )
      .orderBy(desc(docRefreshJobs.createdAt))
      .limit(1);

    return rows[0] === undefined ? null : normalizeRefreshJob(rows[0]);
  }

  async recordRetrievalEvent(input: RecordRetrievalEventInput): Promise<RetrievalEvent> {
    const rows = await this.drizzle()
      .insert(docRetrievalEvents)
      .values({
        sourceId: input.sourceId,
        queryHash: input.queryHash,
        mode: input.mode,
        resultCount: input.resultCount,
        confidence: input.confidence,
        lowConfidence: input.lowConfidence,
        refreshQueued: input.refreshQueued
      })
      .returning({
        id: docRetrievalEvents.id,
        sourceId: docRetrievalEvents.sourceId,
        queryHash: docRetrievalEvents.queryHash
      });

    return requiredRow(rows, "recordRetrievalEvent");
  }
}
