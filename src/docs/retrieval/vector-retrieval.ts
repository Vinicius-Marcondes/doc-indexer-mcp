import type { EmbeddingProvider, EmbeddingProviderMetadata } from "../embeddings/provider";
import { validateEmbeddingDimensions } from "../embeddings/provider";
import type { SqlClient } from "../storage/database";
import { createStructuredError, type StructuredError } from "../../shared/errors";

const SCHEMA_VECTOR_DIMENSIONS = 1536;

export interface VectorRetrievalOptions {
  readonly sql: SqlClient;
  readonly embeddingProvider: EmbeddingProvider;
  readonly defaultLimit: number;
  readonly maxLimit: number;
}

export interface VectorSearchInput {
  readonly sourceId: string;
  readonly query: string;
  readonly limit?: number;
}

export interface VectorRetrievalResultItem {
  readonly chunkId: number;
  readonly pageId: number;
  readonly title: string;
  readonly url: string;
  readonly headingPath: readonly string[];
  readonly snippet: string;
  readonly score: number;
  readonly keywordScore: 0;
  readonly vectorScore: number;
  readonly rerankScore: 0;
  readonly fetchedAt: string;
  readonly indexedAt: string;
  readonly contentHash: string;
}

export interface VectorSearchSuccess {
  readonly ok: true;
  readonly sourceId: string;
  readonly query: string;
  readonly limit: number;
  readonly embedding: EmbeddingProviderMetadata;
  readonly results: readonly VectorRetrievalResultItem[];
}

export interface VectorSearchFailure {
  readonly ok: false;
  readonly sourceId: string;
  readonly query: string;
  readonly limit: number;
  readonly error: StructuredError;
  readonly results: readonly [];
}

export type VectorSearchResult = VectorSearchSuccess | VectorSearchFailure;

interface VectorRetrievalRow extends Record<string, unknown> {
  readonly chunk_id: number;
  readonly page_id: number;
  readonly title: string;
  readonly url: string;
  readonly heading_path: string[];
  readonly content: string;
  readonly score: number;
  readonly vector_score: number;
  readonly fetched_at: string;
  readonly indexed_at: string;
  readonly content_hash: string;
}

export function boundVectorRetrievalLimit(limit: number | undefined, defaultLimit: number, maxLimit: number): number {
  const selectedLimit = limit === undefined ? defaultLimit : Math.floor(limit);
  return Math.min(Math.max(selectedLimit, 1), maxLimit);
}

function toIsoString(value: string): string {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? value : new Date(timestamp).toISOString();
}

function buildSnippet(content: string): string {
  return content.replace(/\s+/gu, " ").trim().slice(0, 240);
}

function mapRow(row: VectorRetrievalRow): VectorRetrievalResultItem {
  const score = Number(row.score);

  return {
    chunkId: Number(row.chunk_id),
    pageId: Number(row.page_id),
    title: row.title,
    url: row.url,
    headingPath: row.heading_path,
    snippet: buildSnippet(row.content),
    score,
    keywordScore: 0,
    vectorScore: Number(row.vector_score),
    rerankScore: 0,
    fetchedAt: toIsoString(String(row.fetched_at)),
    indexedAt: toIsoString(String(row.indexed_at)),
    contentHash: row.content_hash
  };
}

function createInvalidEmbeddingResult(input: {
  readonly sourceId: string;
  readonly query: string;
  readonly limit: number;
  readonly error: StructuredError;
}): VectorSearchFailure {
  return {
    ok: false,
    sourceId: input.sourceId,
    query: input.query,
    limit: input.limit,
    error: input.error,
    results: []
  };
}

function validateProviderMetadata(metadata: EmbeddingProviderMetadata): StructuredError | null {
  if (metadata.dimensions === SCHEMA_VECTOR_DIMENSIONS) {
    return null;
  }

  return createStructuredError("invalid_input", "Embedding provider dimensions are not compatible with the docs schema.", {
    expectedDimensions: SCHEMA_VECTOR_DIMENSIONS,
    actualDimensions: metadata.dimensions,
    provider: metadata.provider,
    model: metadata.model,
    embeddingVersion: metadata.embeddingVersion
  });
}

export class PostgresVectorRetrieval {
  private readonly sql: SqlClient;
  private readonly embeddingProvider: EmbeddingProvider;
  private readonly defaultLimit: number;
  private readonly maxLimit: number;

  constructor(options: VectorRetrievalOptions) {
    this.sql = options.sql;
    this.embeddingProvider = options.embeddingProvider;
    this.defaultLimit = options.defaultLimit;
    this.maxLimit = options.maxLimit;
  }

  async search(input: VectorSearchInput): Promise<VectorSearchResult> {
    const query = input.query.trim();
    const limit = boundVectorRetrievalLimit(input.limit, this.defaultLimit, this.maxLimit);

    if (query.length === 0) {
      return {
        ok: true,
        sourceId: input.sourceId,
        query,
        limit,
        embedding: this.embeddingProvider.metadata,
        results: []
      };
    }

    const metadataError = validateProviderMetadata(this.embeddingProvider.metadata);

    if (metadataError !== null) {
      return createInvalidEmbeddingResult({
        sourceId: input.sourceId,
        query,
        limit,
        error: metadataError
      });
    }

    const embeddingResult = await this.embeddingProvider.embedTexts({ texts: [query] });

    if (!embeddingResult.ok) {
      return createInvalidEmbeddingResult({
        sourceId: input.sourceId,
        query,
        limit,
        error: embeddingResult.error
      });
    }

    const queryEmbedding = embeddingResult.embeddings[0];

    if (queryEmbedding === undefined) {
      return createInvalidEmbeddingResult({
        sourceId: input.sourceId,
        query,
        limit,
        error: createStructuredError("invalid_input", "Embedding provider returned no query embedding.", {
          provider: embeddingResult.metadata.provider,
          model: embeddingResult.metadata.model
        })
      });
    }

    const dimensionValidation = validateEmbeddingDimensions(queryEmbedding.vector, embeddingResult.metadata.dimensions);

    if (!dimensionValidation.ok) {
      return createInvalidEmbeddingResult({
        sourceId: input.sourceId,
        query,
        limit,
        error: dimensionValidation.error
      });
    }

    const resultMetadata = embeddingResult.metadata;
    const resultMetadataError = validateProviderMetadata(resultMetadata);

    if (resultMetadataError !== null) {
      return createInvalidEmbeddingResult({
        sourceId: input.sourceId,
        query,
        limit,
        error: resultMetadataError
      });
    }

    const vectorLiteral = `[${queryEmbedding.vector.join(",")}]`;
    const rows = await this.sql<VectorRetrievalRow[]>`
      with query_embedding as (
        select ${vectorLiteral}::vector as embedding
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
        (1.0 - (e.embedding <=> query_embedding.embedding))::double precision as score,
        (1.0 - (e.embedding <=> query_embedding.embedding))::double precision as vector_score
      from doc_embeddings e
      join doc_chunks c on c.id = e.chunk_id
      join doc_pages p on p.id = c.page_id
      cross join query_embedding
      where c.source_id = ${input.sourceId}
        and p.tombstoned_at is null
        and e.provider = ${resultMetadata.provider}
        and e.model = ${resultMetadata.model}
        and e.embedding_version = ${resultMetadata.embeddingVersion}
        and e.dimensions = ${resultMetadata.dimensions}
      order by e.embedding <=> query_embedding.embedding asc, c.chunk_index asc, c.id asc
      limit ${limit}
    `;

    return {
      ok: true,
      sourceId: input.sourceId,
      query,
      limit,
      embedding: resultMetadata,
      results: rows.map(mapRow)
    };
  }
}
