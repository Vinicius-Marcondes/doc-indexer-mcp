import type { SqlClient } from "./database";
import type { StoredDocsChunk, StoredDocsPage, StoredDocsSourceStats } from "../../resources/docs-resources";

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

export interface RefreshJob {
  readonly id: number;
  readonly sourceId: string;
  readonly url: string | null;
  readonly jobType: RefreshJobType;
  readonly reason: RefreshJobReason;
  readonly status: string;
  readonly priority: number;
  readonly runAfter: string;
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

interface SourceRow extends Record<string, unknown> {
  readonly id: number;
  readonly source_id: string;
  readonly display_name: string;
  readonly enabled: boolean;
  readonly allowed_url_patterns: string[];
  readonly default_ttl_seconds: number;
}

interface PageRow extends Record<string, unknown> {
  readonly id: number;
  readonly source_id: string;
  readonly url: string;
  readonly canonical_url: string;
  readonly title: string;
  readonly content_hash: string;
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

interface ChunkRow extends Record<string, unknown> {
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
  readonly status: string;
  readonly priority: number;
  readonly run_after: string;
}

interface RetrievalEventRow extends Record<string, unknown> {
  readonly id: number;
  readonly source_id: string;
  readonly query_hash: string;
}

function requiredRow<T>(rows: readonly T[], context: string): T {
  const row = rows[0];

  if (row === undefined) {
    throw new Error(`Expected row for ${context}.`);
  }

  return row;
}

function mapSource(row: SourceRow): DocSource {
  return {
    id: row.id,
    sourceId: row.source_id,
    displayName: row.display_name,
    enabled: row.enabled,
    allowedUrlPatterns: row.allowed_url_patterns,
    defaultTtlSeconds: row.default_ttl_seconds
  };
}

function mapPage(row: PageRow): DocPage {
  return {
    id: row.id,
    sourceId: row.source_id,
    url: row.url,
    canonicalUrl: row.canonical_url,
    title: row.title,
    contentHash: row.content_hash
  };
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

function mapChunk(row: ChunkRow): DocChunk {
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
    tokenEstimate: row.token_estimate
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
    runAfter: toIsoString(row.run_after) ?? row.run_after
  };
}

function mapRetrievalEvent(row: RetrievalEventRow): RetrievalEvent {
  return {
    id: row.id,
    sourceId: row.source_id,
    queryHash: row.query_hash
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

export class RemoteDocsStorage {
  constructor(private readonly sql: SqlClient) {}

  async upsertSource(input: UpsertSourceInput): Promise<DocSource> {
    const rows = await this.sql<SourceRow[]>`
      insert into doc_sources (source_id, display_name, enabled, allowed_url_patterns, default_ttl_seconds)
      values (${input.sourceId}, ${input.displayName}, ${input.enabled}, ${JSON.stringify(input.allowedUrlPatterns)}::jsonb, ${input.defaultTtlSeconds})
      on conflict (source_id) do update set
        display_name = excluded.display_name,
        enabled = excluded.enabled,
        allowed_url_patterns = excluded.allowed_url_patterns,
        default_ttl_seconds = excluded.default_ttl_seconds,
        updated_at = now()
      returning id, source_id, display_name, enabled, allowed_url_patterns, default_ttl_seconds
    `;

    return mapSource(requiredRow(rows, "upsertSource"));
  }

  async getSource(sourceId: string): Promise<DocSource | null> {
    const rows = await this.sql<SourceRow[]>`
      select id, source_id, display_name, enabled, allowed_url_patterns, default_ttl_seconds
      from doc_sources
      where source_id = ${sourceId}
    `;

    return rows[0] === undefined ? null : mapSource(rows[0]);
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
    const rows = await this.sql<PageRow[]>`
      select id, source_id, url, canonical_url, title, content_hash
      from doc_pages
      where source_id = ${sourceId} and canonical_url = ${canonicalUrl}
    `;

    return rows[0] === undefined ? null : mapPage(rows[0]);
  }

  async getPageByUrl(input: { readonly sourceId: string; readonly url: string }): Promise<StoredDocsPage | null> {
    const rows = await this.sql<PageDetailRow[]>`
      select
        id,
        source_id,
        url,
        canonical_url,
        title,
        content,
        content_hash,
        fetched_at::text as fetched_at,
        indexed_at::text as indexed_at,
        expires_at::text as expires_at,
        tombstoned_at::text as tombstoned_at,
        tombstone_reason
      from doc_pages
      where source_id = ${input.sourceId}
        and (url = ${input.url} or canonical_url = ${input.url})
    `;

    return rows[0] === undefined ? null : mapPageDetail(rows[0]);
  }

  async getPageById(input: { readonly sourceId: string; readonly pageId: number }): Promise<StoredDocsPage | null> {
    const rows = await this.sql<PageDetailRow[]>`
      select
        id,
        source_id,
        url,
        canonical_url,
        title,
        content,
        content_hash,
        fetched_at::text as fetched_at,
        indexed_at::text as indexed_at,
        expires_at::text as expires_at,
        tombstoned_at::text as tombstoned_at,
        tombstone_reason
      from doc_pages
      where source_id = ${input.sourceId}
        and id = ${input.pageId}
    `;

    return rows[0] === undefined ? null : mapPageDetail(rows[0]);
  }

  async upsertPage(input: UpsertPageInput): Promise<DocPage> {
    const rows = await this.sql<PageRow[]>`
      insert into doc_pages (
        source_id, url, canonical_url, title, content, content_hash, http_status, fetched_at, indexed_at, expires_at
      )
      values (
        ${input.sourceId},
        ${input.url},
        ${input.canonicalUrl},
        ${input.title},
        ${input.content},
        ${input.contentHash},
        ${input.httpStatus},
        ${input.fetchedAt},
        ${input.indexedAt},
        ${input.expiresAt ?? null}
      )
      on conflict (source_id, canonical_url) do update set
        url = excluded.url,
        title = excluded.title,
        content = excluded.content,
        content_hash = excluded.content_hash,
        http_status = excluded.http_status,
        fetched_at = excluded.fetched_at,
        indexed_at = excluded.indexed_at,
        expires_at = excluded.expires_at,
        tombstoned_at = null,
        tombstone_reason = null,
        updated_at = now()
      returning id, source_id, url, canonical_url, title, content_hash
    `;

    return mapPage(requiredRow(rows, "upsertPage"));
  }

  async insertChunks(input: InsertChunksInput): Promise<DocChunk[]> {
    return this.sql.begin(async (transaction) => {
      const chunks: DocChunk[] = [];

      for (const chunk of input.chunks) {
        const rows = await transaction<ChunkRow[]>`
          insert into doc_chunks (
            source_id, page_id, url, title, heading_path, chunk_index, content, content_hash, token_estimate
          )
          values (
            ${input.sourceId},
            ${input.pageId},
            ${chunk.url},
            ${chunk.title},
            ${chunk.headingPath}::text[],
            ${chunk.chunkIndex},
            ${chunk.content},
            ${chunk.contentHash},
            ${chunk.tokenEstimate}
          )
          returning id, source_id, page_id, url, title, heading_path, chunk_index, content, content_hash, token_estimate
        `;

        chunks.push(mapChunk(requiredRow(rows, "insertChunks")));
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
    const rows = await this.sql<Array<{ id: number }>>`
      delete from doc_chunks
      where page_id = ${pageId}
      returning id
    `;

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
      returning id, chunk_id, provider, model, embedding_version, dimensions
    `;

    return mapEmbedding(requiredRow(rows, "insertEmbedding"));
  }

  async createRefreshJob(input: CreateRefreshJobInput): Promise<RefreshJob> {
    const rows = await this.sql<RefreshJobRow[]>`
      insert into doc_refresh_jobs (source_id, url, job_type, reason, priority, run_after)
      values (${input.sourceId}, ${input.url ?? null}, ${input.jobType}, ${input.reason}, ${input.priority}, ${input.runAfter ?? new Date().toISOString()})
      returning id, source_id, url, job_type, reason, status, priority, run_after::text as run_after
    `;

    return mapRefreshJob(requiredRow(rows, "createRefreshJob"));
  }

  async findPendingRefreshJob(input: {
    readonly sourceId: string;
    readonly url?: string;
    readonly jobType: RefreshJobType;
  }): Promise<RefreshJob | null> {
    const rows = await this.sql<RefreshJobRow[]>`
      select id, source_id, url, job_type, reason, status, priority, run_after::text as run_after
      from doc_refresh_jobs
      where source_id = ${input.sourceId}
        and coalesce(url, '') = coalesce(${input.url ?? null}, '')
        and job_type = ${input.jobType}
        and status in ('queued', 'running')
      order by priority desc, created_at asc
      limit 1
    `;

    return rows[0] === undefined ? null : mapRefreshJob(rows[0]);
  }

  async countPendingRefreshJobs(input: { readonly sourceId?: string } = {}): Promise<number> {
    const rows = await this.sql<Array<{ count: number }>>`
      select count(*)::integer as count
      from doc_refresh_jobs
      where status in ('queued', 'running')
        and (${input.sourceId ?? null}::text is null or source_id = ${input.sourceId ?? null})
    `;

    return Number(rows[0]?.count ?? 0);
  }

  async updateRefreshJobStatus(input: {
    readonly id: number;
    readonly status: "queued" | "running" | "succeeded" | "failed";
    readonly lastError?: string;
  }): Promise<RefreshJob> {
    const rows = await this.sql<RefreshJobRow[]>`
      update doc_refresh_jobs
      set
        status = ${input.status},
        last_error = ${input.lastError ?? null},
        updated_at = now(),
        started_at = case when ${input.status} = 'running' then now() else started_at end,
        finished_at = case when ${input.status} in ('succeeded', 'failed') then now() else finished_at end
      where id = ${input.id}
      returning id, source_id, url, job_type, reason, status, priority, run_after::text as run_after
    `;

    return mapRefreshJob(requiredRow(rows, "updateRefreshJobStatus"));
  }

  async recordRetrievalEvent(input: RecordRetrievalEventInput): Promise<RetrievalEvent> {
    const rows = await this.sql<RetrievalEventRow[]>`
      insert into doc_retrieval_events (
        source_id, query_hash, mode, result_count, confidence, low_confidence, refresh_queued
      )
      values (
        ${input.sourceId},
        ${input.queryHash},
        ${input.mode},
        ${input.resultCount},
        ${input.confidence},
        ${input.lowConfidence},
        ${input.refreshQueued}
      )
      returning id, source_id, query_hash
    `;

    return mapRetrievalEvent(requiredRow(rows, "recordRetrievalEvent"));
  }
}
