import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  vector
} from "drizzle-orm/pg-core";

const timestampTz = (name: string) => timestamp(name, { withTimezone: true, mode: "string" });
const bigintId = (name: string) => bigint(name, { mode: "number" }).primaryKey().generatedAlwaysAsIdentity();

const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  }
});

export const docSources = pgTable(
  "doc_sources",
  {
    id: bigintId("id"),
    sourceId: text("source_id").notNull(),
    displayName: text("display_name").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    allowedUrlPatterns: jsonb("allowed_url_patterns").$type<readonly string[]>().notNull().default(sql`'[]'::jsonb`),
    defaultTtlSeconds: integer("default_ttl_seconds").notNull().default(604800),
    createdAt: timestampTz("created_at").notNull().defaultNow(),
    updatedAt: timestampTz("updated_at").notNull().defaultNow()
  },
  (table) => [
    unique("doc_sources_source_id_key").on(table.sourceId),
    check("doc_sources_default_ttl_seconds_positive", sql`${table.defaultTtlSeconds} > 0`),
    check("doc_sources_allowed_url_patterns_array", sql`jsonb_typeof(${table.allowedUrlPatterns}) = 'array'`)
  ]
);

export const docPages = pgTable(
  "doc_pages",
  {
    id: bigintId("id"),
    sourceId: text("source_id")
      .notNull()
      .references(() => docSources.sourceId, { onUpdate: "cascade", onDelete: "restrict" }),
    url: text("url").notNull(),
    canonicalUrl: text("canonical_url").notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    contentHash: text("content_hash").notNull(),
    httpStatus: integer("http_status").notNull(),
    fetchedAt: timestampTz("fetched_at").notNull(),
    indexedAt: timestampTz("indexed_at").notNull(),
    expiresAt: timestampTz("expires_at"),
    tombstonedAt: timestampTz("tombstoned_at"),
    tombstoneReason: text("tombstone_reason"),
    createdAt: timestampTz("created_at").notNull().defaultNow(),
    updatedAt: timestampTz("updated_at").notNull().defaultNow()
  },
  (table) => [
    unique("doc_pages_source_canonical_key").on(table.sourceId, table.canonicalUrl),
    check("doc_pages_http_status_valid", sql`${table.httpStatus} between 100 and 599`),
    check("doc_pages_tombstone_reason_present", sql`${table.tombstonedAt} is null or ${table.tombstoneReason} is not null`),
    index("doc_pages_source_url_idx").on(table.sourceId, table.url),
    index("doc_pages_expires_at_idx").on(table.expiresAt).where(sql`${table.tombstonedAt} is null`)
  ]
);

export const docChunks = pgTable(
  "doc_chunks",
  {
    id: bigintId("id"),
    sourceId: text("source_id")
      .notNull()
      .references(() => docSources.sourceId, { onUpdate: "cascade", onDelete: "restrict" }),
    pageId: bigint("page_id", { mode: "number" })
      .notNull()
      .references(() => docPages.id, { onUpdate: "cascade", onDelete: "cascade" }),
    url: text("url").notNull(),
    title: text("title").notNull(),
    headingPath: text("heading_path").array().notNull().default(sql`ARRAY[]::text[]`),
    chunkIndex: integer("chunk_index").notNull(),
    content: text("content").notNull(),
    contentHash: text("content_hash").notNull(),
    tokenEstimate: integer("token_estimate").notNull(),
    searchVector: tsvector("search_vector").notNull().default(sql`''::tsvector`),
    createdAt: timestampTz("created_at").notNull().defaultNow(),
    updatedAt: timestampTz("updated_at").notNull().defaultNow()
  },
  (table) => [
    unique("doc_chunks_page_chunk_index_key").on(table.pageId, table.chunkIndex),
    unique("doc_chunks_source_page_hash_key").on(table.sourceId, table.pageId, table.contentHash),
    check("doc_chunks_chunk_index_nonnegative", sql`${table.chunkIndex} >= 0`),
    check("doc_chunks_token_estimate_nonnegative", sql`${table.tokenEstimate} >= 0`),
    index("doc_chunks_source_url_idx").on(table.sourceId, table.url),
    index("doc_chunks_content_hash_idx").on(table.contentHash),
    index("doc_chunks_search_vector_idx").using("gin", table.searchVector)
  ]
);

export const docEmbeddings = pgTable(
  "doc_embeddings",
  {
    id: bigintId("id"),
    chunkId: bigint("chunk_id", { mode: "number" })
      .notNull()
      .references(() => docChunks.id, { onUpdate: "cascade", onDelete: "cascade" }),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    embeddingVersion: text("embedding_version").notNull(),
    dimensions: integer("dimensions").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }).notNull(),
    createdAt: timestampTz("created_at").notNull().defaultNow()
  },
  (table) => [
    unique("doc_embeddings_chunk_provider_model_version_key").on(
      table.chunkId,
      table.provider,
      table.model,
      table.embeddingVersion
    ),
    check("doc_embeddings_dimensions_v1", sql`${table.dimensions} = 1536`),
    index("doc_embeddings_chunk_id_idx").on(table.chunkId),
    index("doc_embeddings_provider_model_version_idx").on(table.provider, table.model, table.embeddingVersion),
    index("doc_embeddings_embedding_hnsw_idx").using("hnsw", table.embedding.op("vector_cosine_ops"))
  ]
);

export const docRefreshJobs = pgTable(
  "doc_refresh_jobs",
  {
    id: bigintId("id"),
    sourceId: text("source_id")
      .notNull()
      .references(() => docSources.sourceId, { onUpdate: "cascade", onDelete: "restrict" }),
    url: text("url"),
    jobType: text("job_type").$type<"source_index" | "page" | "embedding" | "tombstone_check">().notNull(),
    reason: text("reason").$type<"scheduled" | "missing_content" | "stale_content" | "low_confidence" | "manual">().notNull(),
    status: text("status").$type<"queued" | "running" | "succeeded" | "failed" | "deduplicated">().notNull().default("queued"),
    priority: integer("priority").notNull().default(0),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastError: text("last_error"),
    runAfter: timestampTz("run_after").notNull().defaultNow(),
    startedAt: timestampTz("started_at"),
    finishedAt: timestampTz("finished_at"),
    createdAt: timestampTz("created_at").notNull().defaultNow(),
    updatedAt: timestampTz("updated_at").notNull().defaultNow()
  },
  (table) => [
    check("doc_refresh_jobs_type_valid", sql`${table.jobType} in ('source_index', 'page', 'embedding', 'tombstone_check')`),
    check(
      "doc_refresh_jobs_reason_valid",
      sql`${table.reason} in ('scheduled', 'missing_content', 'stale_content', 'low_confidence', 'manual')`
    ),
    check("doc_refresh_jobs_status_valid", sql`${table.status} in ('queued', 'running', 'succeeded', 'failed', 'deduplicated')`),
    check("doc_refresh_jobs_attempt_count_nonnegative", sql`${table.attemptCount} >= 0`),
    uniqueIndex("doc_refresh_jobs_pending_dedupe_idx")
      .on(table.sourceId, sql`coalesce(${table.url}, '')`, table.jobType)
      .where(sql`${table.status} in ('queued', 'running')`),
    index("doc_refresh_jobs_runnable_idx")
      .on(table.status, table.runAfter, table.priority.desc(), table.createdAt)
      .where(sql`${table.status} = 'queued'`)
  ]
);

export const docRetrievalEvents = pgTable(
  "doc_retrieval_events",
  {
    id: bigintId("id"),
    sourceId: text("source_id")
      .notNull()
      .references(() => docSources.sourceId, { onUpdate: "cascade", onDelete: "restrict" }),
    queryHash: text("query_hash").notNull(),
    mode: text("mode").$type<"hybrid" | "keyword" | "semantic">().notNull(),
    resultCount: integer("result_count").notNull(),
    confidence: text("confidence").$type<"high" | "medium" | "low">().notNull(),
    lowConfidence: boolean("low_confidence").notNull().default(false),
    refreshQueued: boolean("refresh_queued").notNull().default(false),
    createdAt: timestampTz("created_at").notNull().defaultNow()
  },
  (table) => [
    check("doc_retrieval_events_mode_valid", sql`${table.mode} in ('hybrid', 'keyword', 'semantic')`),
    check("doc_retrieval_events_confidence_valid", sql`${table.confidence} in ('high', 'medium', 'low')`),
    check("doc_retrieval_events_result_count_nonnegative", sql`${table.resultCount} >= 0`),
    index("doc_retrieval_events_query_hash_idx").on(table.sourceId, table.queryHash, table.createdAt.desc()),
    index("doc_retrieval_events_created_at_idx").on(table.createdAt.desc())
  ]
);

export const adminUsers = pgTable(
  "admin_users",
  {
    id: bigintId("id"),
    email: text("email").notNull(),
    normalizedEmail: text("normalized_email").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role").$type<"admin" | "viewer">().notNull(),
    disabledAt: timestampTz("disabled_at"),
    lastLoginAt: timestampTz("last_login_at"),
    createdAt: timestampTz("created_at").notNull().defaultNow(),
    updatedAt: timestampTz("updated_at").notNull().defaultNow()
  },
  (table) => [
    unique("admin_users_normalized_email_key").on(table.normalizedEmail),
    check("admin_users_role_valid", sql`${table.role} in ('admin', 'viewer')`),
    check("admin_users_email_nonempty", sql`length(trim(${table.email})) > 0`),
    check("admin_users_password_hash_nonempty", sql`length(trim(${table.passwordHash})) > 0`),
    index("admin_users_role_idx").on(table.role),
    index("admin_users_disabled_at_idx").on(table.disabledAt)
  ]
);

export const adminSessions = pgTable(
  "admin_sessions",
  {
    id: bigintId("id"),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => adminUsers.id, { onUpdate: "cascade", onDelete: "cascade" }),
    sessionTokenHash: text("session_token_hash").notNull(),
    expiresAt: timestampTz("expires_at").notNull(),
    revokedAt: timestampTz("revoked_at"),
    createdAt: timestampTz("created_at").notNull().defaultNow(),
    lastSeenAt: timestampTz("last_seen_at"),
    userAgentHash: text("user_agent_hash"),
    ipHash: text("ip_hash")
  },
  (table) => [
    unique("admin_sessions_token_hash_key").on(table.sessionTokenHash),
    check("admin_sessions_token_hash_nonempty", sql`length(trim(${table.sessionTokenHash})) > 0`),
    index("admin_sessions_user_id_idx").on(table.userId),
    index("admin_sessions_expires_at_idx").on(table.expiresAt),
    index("admin_sessions_active_token_idx").on(table.sessionTokenHash, table.expiresAt).where(sql`${table.revokedAt} is null`)
  ]
);

export const adminAuditEvents = pgTable(
  "admin_audit_events",
  {
    id: bigintId("id"),
    actorUserId: bigint("actor_user_id", { mode: "number" }).references(() => adminUsers.id, {
      onUpdate: "cascade",
      onDelete: "set null"
    }),
    eventType: text("event_type").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestampTz("created_at").notNull().defaultNow()
  },
  (table) => [
    check("admin_audit_events_event_type_nonempty", sql`length(trim(${table.eventType})) > 0`),
    index("admin_audit_events_created_id_idx").on(table.createdAt.desc(), table.id.desc()),
    index("admin_audit_events_actor_user_id_idx").on(table.actorUserId),
    index("admin_audit_events_target_idx").on(table.targetType, table.targetId)
  ]
);

export const remoteDocsDrizzleSchema = {
  docSources,
  docPages,
  docChunks,
  docEmbeddings,
  docRefreshJobs,
  docRetrievalEvents,
  adminUsers,
  adminSessions,
  adminAuditEvents
};
