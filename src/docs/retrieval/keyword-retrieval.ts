import type { SqlClient } from "../storage/database";

export interface KeywordRetrievalOptions {
  readonly sql: SqlClient;
  readonly defaultLimit: number;
  readonly maxLimit: number;
}

export interface KeywordSearchInput {
  readonly sourceId: string;
  readonly query: string;
  readonly limit?: number;
}

export interface KeywordRetrievalResultItem {
  readonly chunkId: number;
  readonly pageId: number;
  readonly title: string;
  readonly url: string;
  readonly headingPath: readonly string[];
  readonly snippet: string;
  readonly score: number;
  readonly keywordScore: number;
  readonly vectorScore: 0;
  readonly rerankScore: 0;
  readonly fetchedAt: string;
  readonly indexedAt: string;
  readonly contentHash: string;
}

export interface KeywordSearchResult {
  readonly sourceId: string;
  readonly query: string;
  readonly limit: number;
  readonly results: readonly KeywordRetrievalResultItem[];
}

interface KeywordRetrievalRow extends Record<string, unknown> {
  readonly chunk_id: number;
  readonly page_id: number;
  readonly title: string;
  readonly url: string;
  readonly heading_path: string[];
  readonly content: string;
  readonly score: number;
  readonly keyword_score: number;
  readonly fetched_at: string;
  readonly indexed_at: string;
  readonly content_hash: string;
}

export function boundKeywordRetrievalLimit(limit: number | undefined, defaultLimit: number, maxLimit: number): number {
  const selectedLimit = limit === undefined ? defaultLimit : Math.floor(limit);
  return Math.min(Math.max(selectedLimit, 1), maxLimit);
}

export function extractExactKeywordTerms(query: string): readonly string[] {
  const terms = new Set<string>();
  const trimmed = query.trim();
  const exactPattern = /--[a-z0-9][a-z0-9-]*|[A-Za-z_$][\w$]*(?:[.:/-][A-Za-z0-9_$-]+)+/gu;

  for (const match of trimmed.matchAll(exactPattern)) {
    const value = match[0]?.trim();

    if (value !== undefined && value.length > 0) {
      terms.add(value);
    }
  }

  if (trimmed.length > 0 && trimmed.length <= 120) {
    terms.add(trimmed);
  }

  return [...terms];
}

function toIsoString(value: string): string {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? value : new Date(timestamp).toISOString();
}

function buildSnippet(content: string, query: string, exactTerms: readonly string[]): string {
  const normalized = content.replace(/\s+/gu, " ").trim();
  const haystack = normalized.toLowerCase();
  const candidates = [...exactTerms, ...query.split(/\s+/u)].filter((term) => term.length > 0);
  const firstMatch = candidates
    .map((term) => haystack.indexOf(term.toLowerCase()))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];

  if (firstMatch === undefined) {
    return normalized.slice(0, 240);
  }

  const start = Math.max(0, firstMatch - 80);
  const end = Math.min(normalized.length, firstMatch + 180);
  const prefix = start === 0 ? "" : "...";
  const suffix = end === normalized.length ? "" : "...";

  return `${prefix}${normalized.slice(start, end)}${suffix}`;
}

function mapRow(row: KeywordRetrievalRow, query: string, exactTerms: readonly string[]): KeywordRetrievalResultItem {
  return {
    chunkId: Number(row.chunk_id),
    pageId: Number(row.page_id),
    title: row.title,
    url: row.url,
    headingPath: row.heading_path,
    snippet: buildSnippet(row.content, query, exactTerms),
    score: Number(row.score),
    keywordScore: Number(row.keyword_score),
    vectorScore: 0,
    rerankScore: 0,
    fetchedAt: toIsoString(String(row.fetched_at)),
    indexedAt: toIsoString(String(row.indexed_at)),
    contentHash: row.content_hash
  };
}

export class PostgresKeywordRetrieval {
  private readonly sql: SqlClient;
  private readonly defaultLimit: number;
  private readonly maxLimit: number;

  constructor(options: KeywordRetrievalOptions) {
    this.sql = options.sql;
    this.defaultLimit = options.defaultLimit;
    this.maxLimit = options.maxLimit;
  }

  async search(input: KeywordSearchInput): Promise<KeywordSearchResult> {
    const query = input.query.trim();
    const limit = boundKeywordRetrievalLimit(input.limit, this.defaultLimit, this.maxLimit);

    if (query.length === 0) {
      return {
        sourceId: input.sourceId,
        query,
        limit,
        results: []
      };
    }

    const exactTerms = extractExactKeywordTerms(query);
    const rows = await this.sql<KeywordRetrievalRow[]>`
      with input as (
        select
          websearch_to_tsquery('english', ${query}) as tsq,
          ${exactTerms}::text[] as exact_terms
      )
      select
        c.id as chunk_id,
        c.page_id,
        c.title,
        c.url,
        c.heading_path,
        c.content,
        c.content_hash,
        p.fetched_at::text as fetched_at,
        p.indexed_at::text as indexed_at,
        (
          ts_rank_cd(c.search_vector, input.tsq)
          + exact.exact_score
        )::double precision as score,
        (
          ts_rank_cd(c.search_vector, input.tsq)
          + exact.exact_score
        )::double precision as keyword_score
      from doc_chunks c
      join doc_pages p on p.id = c.page_id
      cross join input
      cross join lateral (
        select count(*)::double precision * 2.0 as exact_score
        from unnest(input.exact_terms) as term(value)
        where lower(c.content) like '%' || lower(term.value) || '%'
           or lower(c.title) like '%' || lower(term.value) || '%'
           or lower(array_to_string(c.heading_path, ' ')) like '%' || lower(term.value) || '%'
      ) exact
      where c.source_id = ${input.sourceId}
        and p.tombstoned_at is null
        and (
          c.search_vector @@ input.tsq
          or exact.exact_score > 0
        )
      order by score desc, c.chunk_index asc, c.id asc
      limit ${limit}
    `;

    return {
      sourceId: input.sourceId,
      query,
      limit,
      results: rows.map((row) => mapRow(row, query, exactTerms))
    };
  }
}
