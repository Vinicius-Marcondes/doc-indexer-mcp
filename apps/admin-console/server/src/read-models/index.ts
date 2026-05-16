import type { SqlClient } from "@bun-dev-intel/db";

export const adminKpiWindows = ["1h", "24h", "7d", "30d"] as const;

export type AdminKpiWindow = (typeof adminKpiWindows)[number];
export type PageFreshness = "fresh" | "stale" | "expired" | "tombstoned";
export type RefreshJobType = "source_index" | "page" | "embedding" | "tombstone_check";
export type RefreshJobReason = "scheduled" | "missing_content" | "stale_content" | "low_confidence" | "manual";
export type RefreshJobStatus = "queued" | "running" | "succeeded" | "failed" | "deduplicated";

export interface PaginationInput {
  readonly limit?: number;
  readonly cursor?: number;
}

export interface Pagination {
  readonly limit: number;
  readonly cursor: number | null;
}

export interface PaginatedResult<T> {
  readonly items: readonly T[];
  readonly nextCursor: number | null;
}

export interface RetrievalKpis {
  readonly searches: number;
  readonly zeroResultCount: number;
  readonly zeroResultRate: number | null;
  readonly lowConfidenceCount: number;
  readonly lowConfidenceRate: number | null;
  readonly refreshQueuedCount: number;
  readonly staleResultRate: {
    readonly available: false;
    readonly value: null;
    readonly reason: string;
  };
}

export interface AdminOverviewKpis extends RetrievalKpis {
  readonly window: AdminKpiWindow;
  readonly windowStartedAt: string;
  readonly generatedAt: string;
  readonly totalSources: number;
  readonly enabledSources: number;
  readonly totalPages: number;
  readonly totalChunks: number;
  readonly totalEmbeddings: number;
  readonly embeddedChunkCount: number;
  readonly embeddingCoverage: number | null;
  readonly stalePages: number;
  readonly tombstonedPages: number;
  readonly queuedJobs: number;
  readonly runningJobs: number;
  readonly failedJobs: number;
}

export interface AdminJobSummary {
  readonly id: number;
  readonly sourceId: string;
  readonly url: string | null;
  readonly jobType: RefreshJobType;
  readonly reason: RefreshJobReason;
  readonly status: RefreshJobStatus;
  readonly priority: number;
  readonly attemptCount: number;
  readonly lastError: string | null;
  readonly runAfter: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AdminSourceHealth {
  readonly sourceId: string;
  readonly displayName: string;
  readonly enabled: boolean;
  readonly allowedUrlPatterns: readonly string[];
  readonly defaultTtlSeconds: number;
  readonly pageCount: number;
  readonly chunkCount: number;
  readonly embeddingCount: number;
  readonly embeddedChunkCount: number;
  readonly embeddingCoverage: number | null;
  readonly stalePages: number;
  readonly tombstonedPages: number;
  readonly oldestFetchedPage: string | null;
  readonly newestIndexedPage: string | null;
  readonly latestSuccessfulJob: AdminJobSummary | null;
  readonly latestFailedJob: AdminJobSummary | null;
}

export interface AdminPageListFilters extends PaginationInput {
  readonly sourceId: string;
  readonly q?: string;
  readonly freshness?: PageFreshness;
  readonly hasEmbedding?: boolean;
  readonly now: string;
}

export interface AdminPageListItem {
  readonly id: number;
  readonly sourceId: string;
  readonly url: string;
  readonly canonicalUrl: string;
  readonly title: string;
  readonly httpStatus: number;
  readonly contentHash: string;
  readonly freshness: PageFreshness;
  readonly fetchedAt: string;
  readonly indexedAt: string;
  readonly expiresAt: string | null;
  readonly tombstonedAt: string | null;
  readonly tombstoneReason: string | null;
  readonly chunkCount: number;
  readonly embeddingCount: number;
  readonly hasEmbedding: boolean;
}

export interface AdminPageChunkSummary {
  readonly id: number;
  readonly chunkIndex: number;
  readonly headingPath: readonly string[];
  readonly tokenEstimate: number;
  readonly contentHash: string;
  readonly embeddingCount: number;
  readonly hasEmbedding: boolean;
}

export interface AdminPageDetail extends AdminPageListItem {
  readonly content: string;
  readonly chunks: readonly AdminPageChunkSummary[];
}

export interface AdminChunkDetail {
  readonly id: number;
  readonly sourceId: string;
  readonly pageId: number;
  readonly pageTitle: string;
  readonly pageUrl: string;
  readonly pageCanonicalUrl: string;
  readonly pageTombstonedAt: string | null;
  readonly title: string;
  readonly headingPath: readonly string[];
  readonly chunkIndex: number;
  readonly content: string;
  readonly contentHash: string;
  readonly tokenEstimate: number;
  readonly embeddingCount: number;
  readonly hasEmbedding: boolean;
  readonly previousChunkId: number | null;
  readonly nextChunkId: number | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AdminJobListFilters extends PaginationInput {
  readonly sourceId?: string;
  readonly status?: RefreshJobStatus;
  readonly jobType?: RefreshJobType;
  readonly reason?: RefreshJobReason;
  readonly urlContains?: string;
  readonly window?: AdminKpiWindow;
  readonly now?: string;
}

export interface AdminAuditEvent {
  readonly id: number;
  readonly actorUserId: number | null;
  readonly eventType: string;
  readonly targetType: string | null;
  readonly targetId: string | null;
  readonly details: Record<string, unknown>;
  readonly createdAt: string;
}

export type AdminAuditEventsResult =
  | {
      readonly available: true;
      readonly items: readonly AdminAuditEvent[];
      readonly nextCursor: number | null;
    }
  | {
      readonly available: false;
      readonly items: readonly [];
      readonly nextCursor: null;
      readonly reason: string;
    };

interface OverviewStatsRow extends Record<string, unknown> {
  readonly total_sources: number;
  readonly enabled_sources: number;
  readonly total_pages: number;
  readonly total_chunks: number;
  readonly total_embeddings: number;
  readonly embedded_chunk_count: number;
  readonly stale_pages: number;
  readonly tombstoned_pages: number;
  readonly queued_jobs: number;
  readonly running_jobs: number;
  readonly failed_jobs: number;
}

interface RetrievalKpiRow extends Record<string, unknown> {
  readonly searches: number;
  readonly zero_result_count: number;
  readonly low_confidence_count: number;
  readonly refresh_queued_count: number;
}

interface JobRow extends Record<string, unknown> {
  readonly id: number;
  readonly source_id: string;
  readonly url: string | null;
  readonly job_type: RefreshJobType;
  readonly reason: RefreshJobReason;
  readonly status: RefreshJobStatus;
  readonly priority: number;
  readonly attempt_count: number;
  readonly last_error: string | null;
  readonly run_after: string;
  readonly started_at: string | null;
  readonly finished_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

interface SourceHealthRow extends Record<string, unknown> {
  readonly source_id: string;
  readonly display_name: string;
  readonly enabled: boolean;
  readonly allowed_url_patterns: string[];
  readonly default_ttl_seconds: number;
  readonly page_count: number;
  readonly chunk_count: number;
  readonly embedding_count: number;
  readonly embedded_chunk_count: number;
  readonly stale_pages: number;
  readonly tombstoned_pages: number;
  readonly oldest_fetched_page: string | null;
  readonly newest_indexed_page: string | null;
  readonly success_id: number | null;
  readonly success_source_id: string | null;
  readonly success_url: string | null;
  readonly success_job_type: RefreshJobType | null;
  readonly success_reason: RefreshJobReason | null;
  readonly success_status: RefreshJobStatus | null;
  readonly success_priority: number | null;
  readonly success_attempt_count: number | null;
  readonly success_last_error: string | null;
  readonly success_run_after: string | null;
  readonly success_started_at: string | null;
  readonly success_finished_at: string | null;
  readonly success_created_at: string | null;
  readonly success_updated_at: string | null;
  readonly failed_id: number | null;
  readonly failed_source_id: string | null;
  readonly failed_url: string | null;
  readonly failed_job_type: RefreshJobType | null;
  readonly failed_reason: RefreshJobReason | null;
  readonly failed_status: RefreshJobStatus | null;
  readonly failed_priority: number | null;
  readonly failed_attempt_count: number | null;
  readonly failed_last_error: string | null;
  readonly failed_run_after: string | null;
  readonly failed_started_at: string | null;
  readonly failed_finished_at: string | null;
  readonly failed_created_at: string | null;
  readonly failed_updated_at: string | null;
}

interface PageListRow extends Record<string, unknown> {
  readonly id: number;
  readonly source_id: string;
  readonly url: string;
  readonly canonical_url: string;
  readonly title: string;
  readonly content_hash: string;
  readonly http_status: number;
  readonly freshness: PageFreshness;
  readonly fetched_at: string;
  readonly indexed_at: string;
  readonly expires_at: string | null;
  readonly tombstoned_at: string | null;
  readonly tombstone_reason: string | null;
  readonly chunk_count: number;
  readonly embedding_count: number;
  readonly has_embedding: boolean;
}

interface PageDetailRow extends PageListRow {
  readonly content: string;
}

interface PageChunkRow extends Record<string, unknown> {
  readonly id: number;
  readonly chunk_index: number;
  readonly heading_path: string[];
  readonly token_estimate: number;
  readonly content_hash: string;
  readonly embedding_count: number;
  readonly has_embedding: boolean;
}

interface ChunkDetailRow extends Record<string, unknown> {
  readonly id: number;
  readonly source_id: string;
  readonly page_id: number;
  readonly page_title: string;
  readonly page_url: string;
  readonly page_canonical_url: string;
  readonly page_tombstoned_at: string | null;
  readonly title: string;
  readonly heading_path: string[];
  readonly chunk_index: number;
  readonly content: string;
  readonly content_hash: string;
  readonly token_estimate: number;
  readonly embedding_count: number;
  readonly has_embedding: boolean;
  readonly previous_chunk_id: number | null;
  readonly next_chunk_id: number | null;
  readonly created_at: string;
  readonly updated_at: string;
}

interface AuditEventRow extends Record<string, unknown> {
  readonly id: number;
  readonly actor_user_id: number | null;
  readonly event_type: string;
  readonly target_type: string | null;
  readonly target_id: string | null;
  readonly details: Record<string, unknown>;
  readonly created_at: string;
}

const windowSeconds: Record<AdminKpiWindow, number> = {
  "1h": 60 * 60,
  "24h": 24 * 60 * 60,
  "7d": 7 * 24 * 60 * 60,
  "30d": 30 * 24 * 60 * 60
};

const staleResultUnavailableReason = "doc_retrieval_events does not yet store result freshness telemetry.";

function isAdminKpiWindow(value: string): value is AdminKpiWindow {
  return adminKpiWindows.includes(value as AdminKpiWindow);
}

function normalizeOptionalText(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized === undefined || normalized.length === 0 ? null : normalized;
}

function requiredDateMs(value: string, fieldName: string): number {
  const timestamp = Date.parse(value);

  if (Number.isNaN(timestamp)) {
    throw new Error(`${fieldName} must be a valid timestamp.`);
  }

  return timestamp;
}

function toIsoString(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? value : new Date(timestamp).toISOString();
}

function numberOrZero(value: number | string | null | undefined): number {
  return Number(value ?? 0);
}

function mapJob(row: JobRow): AdminJobSummary {
  return {
    id: Number(row.id),
    sourceId: row.source_id,
    url: row.url,
    jobType: row.job_type,
    reason: row.reason,
    status: row.status,
    priority: Number(row.priority),
    attemptCount: Number(row.attempt_count),
    lastError: row.last_error,
    runAfter: toIsoString(row.run_after) ?? row.run_after,
    startedAt: toIsoString(row.started_at),
    finishedAt: toIsoString(row.finished_at),
    createdAt: toIsoString(row.created_at) ?? row.created_at,
    updatedAt: toIsoString(row.updated_at) ?? row.updated_at
  };
}

function mapPrefixedJob(row: SourceHealthRow, prefix: "success" | "failed"): AdminJobSummary | null {
  const id = prefix === "success" ? row.success_id : row.failed_id;

  if (id === null) {
    return null;
  }

  return mapJob({
    id,
    source_id: prefix === "success" ? row.success_source_id ?? row.source_id : row.failed_source_id ?? row.source_id,
    url: prefix === "success" ? row.success_url : row.failed_url,
    job_type: prefix === "success" ? row.success_job_type ?? "source_index" : row.failed_job_type ?? "source_index",
    reason: prefix === "success" ? row.success_reason ?? "manual" : row.failed_reason ?? "manual",
    status: prefix === "success" ? row.success_status ?? "succeeded" : row.failed_status ?? "failed",
    priority: prefix === "success" ? row.success_priority ?? 0 : row.failed_priority ?? 0,
    attempt_count: prefix === "success" ? row.success_attempt_count ?? 0 : row.failed_attempt_count ?? 0,
    last_error: prefix === "success" ? row.success_last_error : row.failed_last_error,
    run_after: prefix === "success" ? row.success_run_after ?? "" : row.failed_run_after ?? "",
    started_at: prefix === "success" ? row.success_started_at : row.failed_started_at,
    finished_at: prefix === "success" ? row.success_finished_at : row.failed_finished_at,
    created_at: prefix === "success" ? row.success_created_at ?? "" : row.failed_created_at ?? "",
    updated_at: prefix === "success" ? row.success_updated_at ?? "" : row.failed_updated_at ?? ""
  });
}

function mapPageListItem(row: PageListRow): AdminPageListItem {
  return {
    id: Number(row.id),
    sourceId: row.source_id,
    url: row.url,
    canonicalUrl: row.canonical_url,
    title: row.title,
    httpStatus: Number(row.http_status),
    contentHash: row.content_hash,
    freshness: row.freshness,
    fetchedAt: toIsoString(row.fetched_at) ?? row.fetched_at,
    indexedAt: toIsoString(row.indexed_at) ?? row.indexed_at,
    expiresAt: toIsoString(row.expires_at),
    tombstonedAt: toIsoString(row.tombstoned_at),
    tombstoneReason: row.tombstone_reason,
    chunkCount: Number(row.chunk_count),
    embeddingCount: Number(row.embedding_count),
    hasEmbedding: row.has_embedding
  };
}

function mapChunkSummary(row: PageChunkRow): AdminPageChunkSummary {
  return {
    id: Number(row.id),
    chunkIndex: Number(row.chunk_index),
    headingPath: row.heading_path,
    tokenEstimate: Number(row.token_estimate),
    contentHash: row.content_hash,
    embeddingCount: Number(row.embedding_count),
    hasEmbedding: row.has_embedding
  };
}

function mapChunkDetail(row: ChunkDetailRow): AdminChunkDetail {
  return {
    id: Number(row.id),
    sourceId: row.source_id,
    pageId: Number(row.page_id),
    pageTitle: row.page_title,
    pageUrl: row.page_url,
    pageCanonicalUrl: row.page_canonical_url,
    pageTombstonedAt: toIsoString(row.page_tombstoned_at),
    title: row.title,
    headingPath: row.heading_path,
    chunkIndex: Number(row.chunk_index),
    content: row.content,
    contentHash: row.content_hash,
    tokenEstimate: Number(row.token_estimate),
    embeddingCount: Number(row.embedding_count),
    hasEmbedding: row.has_embedding,
    previousChunkId: row.previous_chunk_id === null ? null : Number(row.previous_chunk_id),
    nextChunkId: row.next_chunk_id === null ? null : Number(row.next_chunk_id),
    createdAt: toIsoString(row.created_at) ?? row.created_at,
    updatedAt: toIsoString(row.updated_at) ?? row.updated_at
  };
}

function mapAuditEvent(row: AuditEventRow): AdminAuditEvent {
  return {
    id: Number(row.id),
    actorUserId: row.actor_user_id === null ? null : Number(row.actor_user_id),
    eventType: row.event_type,
    targetType: row.target_type,
    targetId: row.target_id,
    details: row.details,
    createdAt: toIsoString(row.created_at) ?? row.created_at
  };
}

export function parseAdminKpiWindow(value: string | null | undefined, fallback: AdminKpiWindow = "24h"): AdminKpiWindow {
  if (value === undefined || value === null || value.trim().length === 0) {
    return fallback;
  }

  const normalized = value.trim();

  if (isAdminKpiWindow(normalized)) {
    return normalized;
  }

  throw new Error(`Unsupported admin KPI window: ${value}.`);
}

export function getAdminKpiWindowStart(window: AdminKpiWindow, now: string): string {
  const nowMs = requiredDateMs(now, "now");
  return new Date(nowMs - windowSeconds[window] * 1000).toISOString();
}

export function calculateRate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) {
    return null;
  }

  return Math.max(0, Math.min(1, numerator / denominator));
}

export function calculateEmbeddingCoverage(input: {
  readonly chunkCount: number;
  readonly embeddedChunkCount: number;
}): number | null {
  return calculateRate(Math.min(input.embeddedChunkCount, input.chunkCount), input.chunkCount);
}

export function classifyPageFreshness(input: {
  readonly now: string;
  readonly defaultTtlSeconds: number;
  readonly expiresAt: string | null;
  readonly tombstonedAt: string | null;
}): PageFreshness {
  if (input.tombstonedAt !== null) {
    return "tombstoned";
  }

  if (input.expiresAt === null) {
    return "fresh";
  }

  const nowMs = requiredDateMs(input.now, "now");
  const expiresMs = requiredDateMs(input.expiresAt, "expiresAt");

  if (expiresMs > nowMs) {
    return "fresh";
  }

  const ttlMs = input.defaultTtlSeconds * 1000;
  return nowMs - expiresMs > ttlMs ? "expired" : "stale";
}

export function normalizePagination(input: PaginationInput, defaults: { readonly defaultLimit?: number; readonly maxLimit?: number } = {}): Pagination {
  const defaultLimit = defaults.defaultLimit ?? 50;
  const maxLimit = defaults.maxLimit ?? 100;
  const requestedLimit = input.limit ?? defaultLimit;

  if (!Number.isInteger(requestedLimit)) {
    throw new Error("Pagination limit must be an integer.");
  }

  const limit = Math.max(1, Math.min(maxLimit, requestedLimit));

  if (input.cursor !== undefined && (!Number.isInteger(input.cursor) || input.cursor < 0)) {
    throw new Error("Pagination cursor must be a non-negative integer.");
  }

  return {
    limit,
    cursor: input.cursor ?? null
  };
}

export class AdminReadModelStorage {
  constructor(private readonly sql: SqlClient) {}

  async getOverview(input: { readonly window: AdminKpiWindow; readonly now: string }): Promise<AdminOverviewKpis> {
    const windowStartedAt = getAdminKpiWindowStart(input.window, input.now);
    const rows = await this.sql<OverviewStatsRow[]>`
      with source_stats as (
        select
          count(*)::integer as total_sources,
          (count(*) filter (where enabled))::integer as enabled_sources
        from doc_sources
      ),
      page_stats as (
        select
          (count(*) filter (where tombstoned_at is null))::integer as total_pages,
          (count(*) filter (
            where tombstoned_at is null
              and expires_at is not null
              and expires_at <= ${input.now}
          ))::integer as stale_pages,
          (count(*) filter (where tombstoned_at is not null))::integer as tombstoned_pages
        from doc_pages
      ),
      chunk_stats as (
        select count(c.id)::integer as total_chunks
        from doc_chunks c
        join doc_pages p on p.id = c.page_id
        where p.tombstoned_at is null
      ),
      embedding_stats as (
        select
          count(e.id)::integer as total_embeddings,
          count(distinct e.chunk_id)::integer as embedded_chunk_count
        from doc_embeddings e
        join doc_chunks c on c.id = e.chunk_id
        join doc_pages p on p.id = c.page_id
        where p.tombstoned_at is null
      ),
      job_stats as (
        select
          (count(*) filter (where status = 'queued'))::integer as queued_jobs,
          (count(*) filter (where status = 'running'))::integer as running_jobs,
          (count(*) filter (
            where status = 'failed'
              and coalesce(finished_at, updated_at, created_at) >= ${windowStartedAt}
              and coalesce(finished_at, updated_at, created_at) <= ${input.now}
          ))::integer as failed_jobs
        from doc_refresh_jobs
      )
      select
        source_stats.total_sources,
        source_stats.enabled_sources,
        page_stats.total_pages,
        chunk_stats.total_chunks,
        embedding_stats.total_embeddings,
        embedding_stats.embedded_chunk_count,
        page_stats.stale_pages,
        page_stats.tombstoned_pages,
        job_stats.queued_jobs,
        job_stats.running_jobs,
        job_stats.failed_jobs
      from source_stats, page_stats, chunk_stats, embedding_stats, job_stats
    `;
    const row = rows[0];

    if (row === undefined) {
      throw new Error("Expected overview KPI row.");
    }

    const retrieval = await this.getRetrievalKpis({ window: input.window, now: input.now });
    const totalChunks = numberOrZero(row.total_chunks);
    const embeddedChunkCount = numberOrZero(row.embedded_chunk_count);

    return {
      ...retrieval,
      window: input.window,
      windowStartedAt,
      generatedAt: input.now,
      totalSources: numberOrZero(row.total_sources),
      enabledSources: numberOrZero(row.enabled_sources),
      totalPages: numberOrZero(row.total_pages),
      totalChunks,
      totalEmbeddings: numberOrZero(row.total_embeddings),
      embeddedChunkCount,
      embeddingCoverage: calculateEmbeddingCoverage({ chunkCount: totalChunks, embeddedChunkCount }),
      stalePages: numberOrZero(row.stale_pages),
      tombstonedPages: numberOrZero(row.tombstoned_pages),
      queuedJobs: numberOrZero(row.queued_jobs),
      runningJobs: numberOrZero(row.running_jobs),
      failedJobs: numberOrZero(row.failed_jobs)
    };
  }

  async getRetrievalKpis(input: { readonly window: AdminKpiWindow; readonly now: string }): Promise<RetrievalKpis> {
    const windowStartedAt = getAdminKpiWindowStart(input.window, input.now);
    const rows = await this.sql<RetrievalKpiRow[]>`
      select
        count(*)::integer as searches,
        (count(*) filter (where result_count = 0))::integer as zero_result_count,
        (count(*) filter (where low_confidence))::integer as low_confidence_count,
        (count(*) filter (where refresh_queued))::integer as refresh_queued_count
      from doc_retrieval_events
      where created_at >= ${windowStartedAt}
        and created_at <= ${input.now}
    `;
    const row = rows[0];

    if (row === undefined) {
      throw new Error("Expected retrieval KPI row.");
    }

    const searches = numberOrZero(row.searches);
    const zeroResultCount = numberOrZero(row.zero_result_count);
    const lowConfidenceCount = numberOrZero(row.low_confidence_count);

    return {
      searches,
      zeroResultCount,
      zeroResultRate: calculateRate(zeroResultCount, searches),
      lowConfidenceCount,
      lowConfidenceRate: calculateRate(lowConfidenceCount, searches),
      refreshQueuedCount: numberOrZero(row.refresh_queued_count),
      staleResultRate: {
        available: false,
        value: null,
        reason: staleResultUnavailableReason
      }
    };
  }

  async listSourceHealth(now: string): Promise<AdminSourceHealth[]> {
    const rows = await this.sourceHealthRows({ sourceId: null, now });
    return rows.map(mapSourceHealth);
  }

  async getSourceHealth(input: { readonly sourceId: string; readonly now: string }): Promise<AdminSourceHealth | null> {
    const rows = await this.sourceHealthRows({ sourceId: input.sourceId, now: input.now });
    const row = rows[0];
    return row === undefined ? null : mapSourceHealth(row);
  }

  async listPages(input: AdminPageListFilters): Promise<PaginatedResult<AdminPageListItem>> {
    const pagination = normalizePagination(input);
    const q = normalizeOptionalText(input.q);
    const freshness = input.freshness ?? null;
    const hasEmbedding = input.hasEmbedding ?? null;
    const rows = await this.sql<PageListRow[]>`
      select
        p.id,
        p.source_id,
        p.url,
        p.canonical_url,
        p.title,
        p.content_hash,
        p.http_status,
        case
          when p.tombstoned_at is not null then 'tombstoned'
          when p.expires_at is null or p.expires_at > ${input.now} then 'fresh'
          when p.expires_at < (${input.now}::timestamptz - s.default_ttl_seconds * interval '1 second') then 'expired'
          else 'stale'
        end as freshness,
        p.fetched_at::text as fetched_at,
        p.indexed_at::text as indexed_at,
        p.expires_at::text as expires_at,
        p.tombstoned_at::text as tombstoned_at,
        p.tombstone_reason,
        count(distinct c.id)::integer as chunk_count,
        count(e.id)::integer as embedding_count,
        (count(e.id) > 0) as has_embedding
      from doc_pages p
      join doc_sources s on s.source_id = p.source_id
      left join doc_chunks c on c.page_id = p.id
      left join doc_embeddings e on e.chunk_id = c.id
      where p.source_id = ${input.sourceId}
        and (${pagination.cursor}::bigint is null or p.id > ${pagination.cursor}::bigint)
        and (
          ${q}::text is null
          or p.title ilike '%' || ${q} || '%'
          or p.url ilike '%' || ${q} || '%'
          or p.canonical_url ilike '%' || ${q} || '%'
        )
      group by p.id, s.default_ttl_seconds
      having (
        ${freshness}::text is null
        or case
          when p.tombstoned_at is not null then 'tombstoned'
          when p.expires_at is null or p.expires_at > ${input.now} then 'fresh'
          when p.expires_at < (${input.now}::timestamptz - s.default_ttl_seconds * interval '1 second') then 'expired'
          else 'stale'
        end = ${freshness}::text
      )
      and (
        ${hasEmbedding}::boolean is null
        or (count(e.id) > 0) = ${hasEmbedding}::boolean
      )
      order by p.id asc
      limit ${pagination.limit + 1}
    `;

    return paginateRows(rows, pagination.limit, mapPageListItem);
  }

  async getPageDetail(input: { readonly sourceId: string; readonly pageId: number; readonly now: string }): Promise<AdminPageDetail | null> {
    const rows = await this.sql<PageDetailRow[]>`
      select
        p.id,
        p.source_id,
        p.url,
        p.canonical_url,
        p.title,
        p.content,
        p.content_hash,
        p.http_status,
        case
          when p.tombstoned_at is not null then 'tombstoned'
          when p.expires_at is null or p.expires_at > ${input.now} then 'fresh'
          when p.expires_at < (${input.now}::timestamptz - s.default_ttl_seconds * interval '1 second') then 'expired'
          else 'stale'
        end as freshness,
        p.fetched_at::text as fetched_at,
        p.indexed_at::text as indexed_at,
        p.expires_at::text as expires_at,
        p.tombstoned_at::text as tombstoned_at,
        p.tombstone_reason,
        count(distinct c.id)::integer as chunk_count,
        count(e.id)::integer as embedding_count,
        (count(e.id) > 0) as has_embedding
      from doc_pages p
      join doc_sources s on s.source_id = p.source_id
      left join doc_chunks c on c.page_id = p.id
      left join doc_embeddings e on e.chunk_id = c.id
      where p.source_id = ${input.sourceId}
        and p.id = ${input.pageId}
      group by p.id, s.default_ttl_seconds
      limit 1
    `;
    const row = rows[0];

    if (row === undefined) {
      return null;
    }

    const chunks = await this.sql<PageChunkRow[]>`
      select
        c.id,
        c.chunk_index,
        c.heading_path,
        c.token_estimate,
        c.content_hash,
        count(e.id)::integer as embedding_count,
        (count(e.id) > 0) as has_embedding
      from doc_chunks c
      left join doc_embeddings e on e.chunk_id = c.id
      where c.page_id = ${input.pageId}
      group by c.id
      order by c.chunk_index asc
    `;

    return {
      ...mapPageListItem(row),
      content: row.content,
      chunks: chunks.map(mapChunkSummary)
    };
  }

  async getChunkDetail(input: { readonly sourceId: string; readonly chunkId: number }): Promise<AdminChunkDetail | null> {
    const rows = await this.sql<ChunkDetailRow[]>`
      select
        c.id,
        c.source_id,
        c.page_id,
        p.title as page_title,
        p.url as page_url,
        p.canonical_url as page_canonical_url,
        p.tombstoned_at::text as page_tombstoned_at,
        c.title,
        c.heading_path,
        c.chunk_index,
        c.content,
        c.content_hash,
        c.token_estimate,
        count(e.id)::integer as embedding_count,
        (count(e.id) > 0) as has_embedding,
        prev.id as previous_chunk_id,
        next.id as next_chunk_id,
        c.created_at::text as created_at,
        c.updated_at::text as updated_at
      from doc_chunks c
      join doc_pages p on p.id = c.page_id
      left join doc_embeddings e on e.chunk_id = c.id
      left join doc_chunks prev on prev.page_id = c.page_id and prev.chunk_index = c.chunk_index - 1
      left join doc_chunks next on next.page_id = c.page_id and next.chunk_index = c.chunk_index + 1
      where c.source_id = ${input.sourceId}
        and c.id = ${input.chunkId}
      group by c.id, p.id, prev.id, next.id
      limit 1
    `;
    const row = rows[0];
    return row === undefined ? null : mapChunkDetail(row);
  }

  async listJobs(input: AdminJobListFilters = {}): Promise<PaginatedResult<AdminJobSummary>> {
    const pagination = normalizePagination(input);
    const sourceId = input.sourceId ?? null;
    const status = input.status ?? null;
    const jobType = input.jobType ?? null;
    const reason = input.reason ?? null;
    const urlContains = normalizeOptionalText(input.urlContains);
    const windowStartedAt = input.window === undefined || input.now === undefined ? null : getAdminKpiWindowStart(input.window, input.now);
    const now = input.now ?? null;
    const rows = await this.sql<JobRow[]>`
      select
        id,
        source_id,
        url,
        job_type,
        reason,
        status,
        priority,
        attempt_count,
        last_error,
        run_after::text as run_after,
        started_at::text as started_at,
        finished_at::text as finished_at,
        created_at::text as created_at,
        updated_at::text as updated_at
      from doc_refresh_jobs
      where (${sourceId}::text is null or source_id = ${sourceId}::text)
        and (${status}::text is null or status = ${status}::text)
        and (${jobType}::text is null or job_type = ${jobType}::text)
        and (${reason}::text is null or reason = ${reason}::text)
        and (${urlContains}::text is null or coalesce(url, '') ilike '%' || ${urlContains} || '%')
        and (${pagination.cursor}::bigint is null or id < ${pagination.cursor}::bigint)
        and (
          ${windowStartedAt}::timestamptz is null
          or (
            coalesce(finished_at, updated_at, created_at) >= ${windowStartedAt}::timestamptz
            and (${now}::timestamptz is null or coalesce(finished_at, updated_at, created_at) <= ${now}::timestamptz)
          )
        )
      order by id desc
      limit ${pagination.limit + 1}
    `;

    return paginateRows(rows, pagination.limit, mapJob);
  }

  async getJobDetail(jobId: number): Promise<AdminJobSummary | null> {
    const rows = await this.sql<JobRow[]>`
      select
        id,
        source_id,
        url,
        job_type,
        reason,
        status,
        priority,
        attempt_count,
        last_error,
        run_after::text as run_after,
        started_at::text as started_at,
        finished_at::text as finished_at,
        created_at::text as created_at,
        updated_at::text as updated_at
      from doc_refresh_jobs
      where id = ${jobId}
      limit 1
    `;
    const row = rows[0];
    return row === undefined ? null : mapJob(row);
  }

  async listAuditEvents(input: PaginationInput = {}): Promise<AdminAuditEventsResult> {
    const availability = await this.sql<Array<{ table_name: string | null }>>`
      select to_regclass('admin_audit_events')::text as table_name
    `;

    if (availability[0]?.table_name === null || availability[0]?.table_name === undefined) {
      return {
        available: false,
        items: [],
        nextCursor: null,
        reason: "admin_audit_events table is not available yet."
      };
    }

    const pagination = normalizePagination(input);
    const rows = await this.sql<AuditEventRow[]>`
      select
        id,
        actor_user_id,
        event_type,
        target_type,
        target_id,
        details,
        created_at::text as created_at
      from admin_audit_events
      where (${pagination.cursor}::bigint is null or id < ${pagination.cursor}::bigint)
      order by id desc
      limit ${pagination.limit + 1}
    `;

    return {
      available: true,
      ...paginateRows(rows, pagination.limit, mapAuditEvent)
    };
  }

  private async sourceHealthRows(input: { readonly sourceId: string | null; readonly now: string }): Promise<SourceHealthRow[]> {
    return this.sql<SourceHealthRow[]>`
      select
        s.source_id,
        s.display_name,
        s.enabled,
        s.allowed_url_patterns,
        s.default_ttl_seconds,
        (
          select count(*)::integer
          from doc_pages p
          where p.source_id = s.source_id
            and p.tombstoned_at is null
        ) as page_count,
        (
          select count(c.id)::integer
          from doc_chunks c
          join doc_pages p on p.id = c.page_id
          where p.source_id = s.source_id
            and p.tombstoned_at is null
        ) as chunk_count,
        (
          select count(e.id)::integer
          from doc_embeddings e
          join doc_chunks c on c.id = e.chunk_id
          join doc_pages p on p.id = c.page_id
          where p.source_id = s.source_id
            and p.tombstoned_at is null
        ) as embedding_count,
        (
          select count(distinct e.chunk_id)::integer
          from doc_embeddings e
          join doc_chunks c on c.id = e.chunk_id
          join doc_pages p on p.id = c.page_id
          where p.source_id = s.source_id
            and p.tombstoned_at is null
        ) as embedded_chunk_count,
        (
          select count(*)::integer
          from doc_pages p
          where p.source_id = s.source_id
            and p.tombstoned_at is null
            and p.expires_at is not null
            and p.expires_at <= ${input.now}
        ) as stale_pages,
        (
          select count(*)::integer
          from doc_pages p
          where p.source_id = s.source_id
            and p.tombstoned_at is not null
        ) as tombstoned_pages,
        (
          select min(p.fetched_at)::text
          from doc_pages p
          where p.source_id = s.source_id
        ) as oldest_fetched_page,
        (
          select max(p.indexed_at)::text
          from doc_pages p
          where p.source_id = s.source_id
        ) as newest_indexed_page,
        success.id as success_id,
        success.source_id as success_source_id,
        success.url as success_url,
        success.job_type as success_job_type,
        success.reason as success_reason,
        success.status as success_status,
        success.priority as success_priority,
        success.attempt_count as success_attempt_count,
        success.last_error as success_last_error,
        success.run_after::text as success_run_after,
        success.started_at::text as success_started_at,
        success.finished_at::text as success_finished_at,
        success.created_at::text as success_created_at,
        success.updated_at::text as success_updated_at,
        failed.id as failed_id,
        failed.source_id as failed_source_id,
        failed.url as failed_url,
        failed.job_type as failed_job_type,
        failed.reason as failed_reason,
        failed.status as failed_status,
        failed.priority as failed_priority,
        failed.attempt_count as failed_attempt_count,
        failed.last_error as failed_last_error,
        failed.run_after::text as failed_run_after,
        failed.started_at::text as failed_started_at,
        failed.finished_at::text as failed_finished_at,
        failed.created_at::text as failed_created_at,
        failed.updated_at::text as failed_updated_at
      from doc_sources s
      left join lateral (
        select *
        from doc_refresh_jobs j
        where j.source_id = s.source_id
          and j.status = 'succeeded'
        order by coalesce(j.finished_at, j.updated_at, j.created_at) desc, j.id desc
        limit 1
      ) success on true
      left join lateral (
        select *
        from doc_refresh_jobs j
        where j.source_id = s.source_id
          and j.status = 'failed'
        order by coalesce(j.finished_at, j.updated_at, j.created_at) desc, j.id desc
        limit 1
      ) failed on true
      where (${input.sourceId}::text is null or s.source_id = ${input.sourceId}::text)
      order by s.source_id asc
    `;
  }
}

function mapSourceHealth(row: SourceHealthRow): AdminSourceHealth {
  const chunkCount = numberOrZero(row.chunk_count);
  const embeddedChunkCount = numberOrZero(row.embedded_chunk_count);

  return {
    sourceId: row.source_id,
    displayName: row.display_name,
    enabled: row.enabled,
    allowedUrlPatterns: row.allowed_url_patterns,
    defaultTtlSeconds: Number(row.default_ttl_seconds),
    pageCount: numberOrZero(row.page_count),
    chunkCount,
    embeddingCount: numberOrZero(row.embedding_count),
    embeddedChunkCount,
    embeddingCoverage: calculateEmbeddingCoverage({ chunkCount, embeddedChunkCount }),
    stalePages: numberOrZero(row.stale_pages),
    tombstonedPages: numberOrZero(row.tombstoned_pages),
    oldestFetchedPage: toIsoString(row.oldest_fetched_page),
    newestIndexedPage: toIsoString(row.newest_indexed_page),
    latestSuccessfulJob: mapPrefixedJob(row, "success"),
    latestFailedJob: mapPrefixedJob(row, "failed")
  };
}

function paginateRows<Row extends { readonly id: number }, Item>(
  rows: readonly Row[],
  limit: number,
  mapRow: (row: Row) => Item
): PaginatedResult<Item> {
  const pageRows = rows.slice(0, limit);
  const lastPageRow = pageRows[pageRows.length - 1];
  const hasMore = rows.length > limit;

  return {
    items: pageRows.map(mapRow),
    nextCursor: hasMore && lastPageRow !== undefined ? Number(lastPageRow.id) : null
  };
}
