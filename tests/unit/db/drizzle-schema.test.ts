import { describe, expect, test } from "bun:test";
import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  adminAuditEvents,
  adminSessions,
  adminUsers,
  docChunks,
  docEmbeddings,
  docPages,
  docRefreshJobs,
  docRetrievalEvents,
  docSources,
  remoteDocsDrizzleSchema
} from "../../../packages/db/src";

function columnNames(table: Parameters<typeof getTableColumns>[0]): Record<string, string> {
  return Object.fromEntries(
    Object.entries(getTableColumns(table)).map(([property, column]) => [property, column.name])
  );
}

describe("remote docs Drizzle schema", () => {
  test("exports every existing remote-docs and admin table", () => {
    expect(Object.keys(remoteDocsDrizzleSchema).sort()).toEqual([
      "adminAuditEvents",
      "adminSessions",
      "adminUsers",
      "docChunks",
      "docEmbeddings",
      "docPages",
      "docRefreshJobs",
      "docRetrievalEvents",
      "docSources"
    ]);

    expect([
      docSources,
      docPages,
      docChunks,
      docEmbeddings,
      docRefreshJobs,
      docRetrievalEvents,
      adminUsers,
      adminSessions,
      adminAuditEvents
    ].map((table) => getTableName(table))).toEqual([
      "doc_sources",
      "doc_pages",
      "doc_chunks",
      "doc_embeddings",
      "doc_refresh_jobs",
      "doc_retrieval_events",
      "admin_users",
      "admin_sessions",
      "admin_audit_events"
    ]);
  });

  test("maps camelCase TypeScript properties onto existing snake_case columns", () => {
    expect(columnNames(docSources)).toMatchObject({
      sourceId: "source_id",
      displayName: "display_name",
      allowedUrlPatterns: "allowed_url_patterns",
      defaultTtlSeconds: "default_ttl_seconds"
    });
    expect(columnNames(docPages)).toMatchObject({
      sourceId: "source_id",
      canonicalUrl: "canonical_url",
      contentHash: "content_hash",
      httpStatus: "http_status",
      fetchedAt: "fetched_at",
      indexedAt: "indexed_at",
      expiresAt: "expires_at",
      tombstonedAt: "tombstoned_at",
      tombstoneReason: "tombstone_reason"
    });
    expect(columnNames(docChunks)).toMatchObject({
      sourceId: "source_id",
      pageId: "page_id",
      headingPath: "heading_path",
      chunkIndex: "chunk_index",
      contentHash: "content_hash",
      tokenEstimate: "token_estimate",
      searchVector: "search_vector"
    });
    expect(columnNames(docEmbeddings)).toMatchObject({
      chunkId: "chunk_id",
      embeddingVersion: "embedding_version"
    });
    expect(columnNames(docRefreshJobs)).toMatchObject({
      sourceId: "source_id",
      jobType: "job_type",
      attemptCount: "attempt_count",
      lastError: "last_error",
      runAfter: "run_after",
      startedAt: "started_at",
      finishedAt: "finished_at"
    });
    expect(columnNames(docRetrievalEvents)).toMatchObject({
      sourceId: "source_id",
      queryHash: "query_hash",
      resultCount: "result_count",
      lowConfidence: "low_confidence",
      refreshQueued: "refresh_queued"
    });
    expect(columnNames(adminUsers)).toMatchObject({
      normalizedEmail: "normalized_email",
      passwordHash: "password_hash",
      disabledAt: "disabled_at",
      lastLoginAt: "last_login_at"
    });
    expect(columnNames(adminSessions)).toMatchObject({
      userId: "user_id",
      sessionTokenHash: "session_token_hash",
      expiresAt: "expires_at",
      revokedAt: "revoked_at",
      lastSeenAt: "last_seen_at",
      userAgentHash: "user_agent_hash",
      ipHash: "ip_hash"
    });
    expect(columnNames(adminAuditEvents)).toMatchObject({
      actorUserId: "actor_user_id",
      eventType: "event_type",
      targetType: "target_type",
      targetId: "target_id"
    });
  });

  test("models pgvector storage and HNSW cosine index metadata", () => {
    const config = getTableConfig(docEmbeddings);
    const embeddingColumn = config.columns.find((column) => column.name === "embedding");
    const hnswIndex = config.indexes.find((index) => index.config.name === "doc_embeddings_embedding_hnsw_idx");
    const indexedColumn = hnswIndex?.config.columns[0] as
      | {
          readonly indexConfig?: {
            readonly opClass?: string;
          };
        }
      | undefined;

    expect(embeddingColumn?.getSQLType()).toBe("vector(1536)");
    expect(hnswIndex?.config.method).toBe("hnsw");
    expect(indexedColumn?.indexConfig?.opClass).toBe("vector_cosine_ops");
  });
});
