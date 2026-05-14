CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS doc_sources (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_id text NOT NULL,
  display_name text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  allowed_url_patterns jsonb NOT NULL DEFAULT '[]'::jsonb,
  default_ttl_seconds integer NOT NULL DEFAULT 604800,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT doc_sources_source_id_key UNIQUE (source_id),
  CONSTRAINT doc_sources_default_ttl_seconds_positive CHECK (default_ttl_seconds > 0),
  CONSTRAINT doc_sources_allowed_url_patterns_array CHECK (jsonb_typeof(allowed_url_patterns) = 'array')
);

CREATE TABLE IF NOT EXISTS doc_pages (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_id text NOT NULL REFERENCES doc_sources (source_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  url text NOT NULL,
  canonical_url text NOT NULL,
  title text NOT NULL,
  content text NOT NULL,
  content_hash text NOT NULL,
  http_status integer NOT NULL,
  fetched_at timestamptz NOT NULL,
  indexed_at timestamptz NOT NULL,
  expires_at timestamptz,
  tombstoned_at timestamptz,
  tombstone_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT doc_pages_source_canonical_key UNIQUE (source_id, canonical_url),
  CONSTRAINT doc_pages_http_status_valid CHECK (http_status BETWEEN 100 AND 599),
  CONSTRAINT doc_pages_tombstone_reason_present CHECK (tombstoned_at IS NULL OR tombstone_reason IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS doc_pages_source_url_idx ON doc_pages (source_id, url);
CREATE INDEX IF NOT EXISTS doc_pages_expires_at_idx ON doc_pages (expires_at) WHERE tombstoned_at IS NULL;

CREATE TABLE IF NOT EXISTS doc_chunks (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_id text NOT NULL REFERENCES doc_sources (source_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  page_id bigint NOT NULL REFERENCES doc_pages (id) ON UPDATE CASCADE ON DELETE CASCADE,
  url text NOT NULL,
  title text NOT NULL,
  heading_path text[] NOT NULL DEFAULT ARRAY[]::text[],
  chunk_index integer NOT NULL,
  content text NOT NULL,
  content_hash text NOT NULL,
  token_estimate integer NOT NULL,
  search_vector tsvector GENERATED ALWAYS AS (
    to_tsvector(
      'english',
      coalesce(title, '') || ' ' || coalesce(array_to_string(heading_path, ' '), '') || ' ' || coalesce(content, '')
    )
  ) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT doc_chunks_page_chunk_index_key UNIQUE (page_id, chunk_index),
  CONSTRAINT doc_chunks_source_page_hash_key UNIQUE (source_id, page_id, content_hash),
  CONSTRAINT doc_chunks_chunk_index_nonnegative CHECK (chunk_index >= 0),
  CONSTRAINT doc_chunks_token_estimate_nonnegative CHECK (token_estimate >= 0)
);

CREATE INDEX IF NOT EXISTS doc_chunks_source_url_idx ON doc_chunks (source_id, url);
CREATE INDEX IF NOT EXISTS doc_chunks_content_hash_idx ON doc_chunks (content_hash);
CREATE INDEX IF NOT EXISTS doc_chunks_search_vector_idx ON doc_chunks USING gin (search_vector);

CREATE TABLE IF NOT EXISTS doc_embeddings (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chunk_id bigint NOT NULL REFERENCES doc_chunks (id) ON UPDATE CASCADE ON DELETE CASCADE,
  provider text NOT NULL,
  model text NOT NULL,
  embedding_version text NOT NULL,
  dimensions integer NOT NULL,
  embedding vector(1536) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT doc_embeddings_chunk_provider_model_version_key UNIQUE (chunk_id, provider, model, embedding_version),
  CONSTRAINT doc_embeddings_dimensions_v1 CHECK (dimensions = 1536)
);

CREATE INDEX IF NOT EXISTS doc_embeddings_chunk_id_idx ON doc_embeddings (chunk_id);
CREATE INDEX IF NOT EXISTS doc_embeddings_provider_model_version_idx ON doc_embeddings (provider, model, embedding_version);
CREATE INDEX IF NOT EXISTS doc_embeddings_embedding_hnsw_idx ON doc_embeddings USING hnsw (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS doc_refresh_jobs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_id text NOT NULL REFERENCES doc_sources (source_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  url text,
  job_type text NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  priority integer NOT NULL DEFAULT 0,
  attempt_count integer NOT NULL DEFAULT 0,
  last_error text,
  run_after timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT doc_refresh_jobs_type_valid CHECK (job_type IN ('source_index', 'page', 'embedding', 'tombstone_check')),
  CONSTRAINT doc_refresh_jobs_reason_valid CHECK (reason IN ('scheduled', 'missing_content', 'stale_content', 'low_confidence', 'manual')),
  CONSTRAINT doc_refresh_jobs_status_valid CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'deduplicated')),
  CONSTRAINT doc_refresh_jobs_attempt_count_nonnegative CHECK (attempt_count >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS doc_refresh_jobs_pending_dedupe_idx
  ON doc_refresh_jobs (source_id, coalesce(url, ''), job_type)
  WHERE status IN ('queued', 'running');

CREATE INDEX IF NOT EXISTS doc_refresh_jobs_runnable_idx
  ON doc_refresh_jobs (status, run_after, priority DESC, created_at)
  WHERE status = 'queued';

CREATE TABLE IF NOT EXISTS doc_retrieval_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_id text NOT NULL REFERENCES doc_sources (source_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  query_hash text NOT NULL,
  mode text NOT NULL,
  result_count integer NOT NULL,
  confidence text NOT NULL,
  low_confidence boolean NOT NULL DEFAULT false,
  refresh_queued boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT doc_retrieval_events_mode_valid CHECK (mode IN ('hybrid', 'keyword', 'semantic')),
  CONSTRAINT doc_retrieval_events_confidence_valid CHECK (confidence IN ('high', 'medium', 'low')),
  CONSTRAINT doc_retrieval_events_result_count_nonnegative CHECK (result_count >= 0)
);

CREATE INDEX IF NOT EXISTS doc_retrieval_events_query_hash_idx ON doc_retrieval_events (source_id, query_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS doc_retrieval_events_created_at_idx ON doc_retrieval_events (created_at DESC);
