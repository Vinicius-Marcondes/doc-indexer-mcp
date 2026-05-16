import * as z from "zod/v4";

export const adminServiceName = "bun-dev-intel-admin-console" as const;

export const adminHealthResponseSchema = z
  .object({
    ok: z.literal(true),
    status: z.enum(["ok", "ready"]),
    service: z.literal(adminServiceName)
  })
  .strict();

export type AdminHealthResponse = z.infer<typeof adminHealthResponseSchema>;

export const adminErrorResponseSchema = z
  .object({
    ok: z.literal(false),
    error: z
      .object({
        code: z.string().min(1),
        message: z.string().min(1),
        status: z.number().int().min(400).max(599)
      })
      .strict()
  })
  .strict();

export type AdminErrorResponse = z.infer<typeof adminErrorResponseSchema>;

export const adminRoleSchema = z.enum(["admin", "viewer"]);
export type AdminRole = z.infer<typeof adminRoleSchema>;

export const adminUserSchema = z
  .object({
    id: z.number().int().nonnegative(),
    email: z.string().email(),
    role: adminRoleSchema
  })
  .strict();

export type AdminUser = z.infer<typeof adminUserSchema>;

export const adminLoginRequestSchema = z
  .object({
    email: z.string().email(),
    password: z.string().min(1)
  })
  .strict();

export type AdminLoginRequest = z.infer<typeof adminLoginRequestSchema>;

export const adminAuthUserResponseSchema = z
  .object({
    ok: z.literal(true),
    user: adminUserSchema
  })
  .strict();

export type AdminAuthUserResponse = z.infer<typeof adminAuthUserResponseSchema>;

export const adminLogoutResponseSchema = z
  .object({
    ok: z.literal(true)
  })
  .strict();

export type AdminLogoutResponse = z.infer<typeof adminLogoutResponseSchema>;

export const adminKpiWindowSchema = z.enum(["1h", "24h", "7d", "30d"]);
export type AdminKpiWindow = z.infer<typeof adminKpiWindowSchema>;

export const adminRefreshJobTypeSchema = z.enum(["source_index", "page", "embedding", "tombstone_check"]);
export const adminRefreshJobReasonSchema = z.enum(["scheduled", "missing_content", "stale_content", "low_confidence", "manual"]);
export const adminRefreshJobStatusSchema = z.enum(["queued", "running", "succeeded", "failed", "deduplicated"]);
export const adminPageFreshnessSchema = z.enum(["fresh", "stale", "expired", "tombstoned"]);
export const adminRetrievalModeSchema = z.enum(["hybrid", "keyword", "semantic"]);
export const adminRetrievalConfidenceSchema = z.enum(["high", "medium", "low"]);
export const adminDocsFreshnessSchema = z.enum(["fresh", "stale", "missing", "refreshing"]);

const rateSchema = z.number().min(0).max(1).nullable();
const isoTimestampSchema = z.string().min(1);

export const adminStaleResultRateSchema = z
  .object({
    available: z.literal(false),
    value: z.null(),
    reason: z.string().min(1)
  })
  .strict();

export const adminRetrievalKpisSchema = z
  .object({
    searches: z.number().int().nonnegative(),
    zeroResultCount: z.number().int().nonnegative(),
    zeroResultRate: rateSchema,
    lowConfidenceCount: z.number().int().nonnegative(),
    lowConfidenceRate: rateSchema,
    refreshQueuedCount: z.number().int().nonnegative(),
    staleResultRate: adminStaleResultRateSchema
  })
  .strict();

export type AdminRetrievalKpis = z.infer<typeof adminRetrievalKpisSchema>;

export const adminOverviewKpisSchema = adminRetrievalKpisSchema
  .extend({
    window: adminKpiWindowSchema,
    windowStartedAt: isoTimestampSchema,
    generatedAt: isoTimestampSchema,
    totalSources: z.number().int().nonnegative(),
    enabledSources: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
    totalChunks: z.number().int().nonnegative(),
    totalEmbeddings: z.number().int().nonnegative(),
    embeddedChunkCount: z.number().int().nonnegative(),
    embeddingCoverage: rateSchema,
    stalePages: z.number().int().nonnegative(),
    tombstonedPages: z.number().int().nonnegative(),
    queuedJobs: z.number().int().nonnegative(),
    runningJobs: z.number().int().nonnegative(),
    failedJobs: z.number().int().nonnegative()
  })
  .strict();

export type AdminOverviewKpis = z.infer<typeof adminOverviewKpisSchema>;

export const adminJobSummarySchema = z
  .object({
    id: z.number().int().nonnegative(),
    sourceId: z.string().min(1),
    url: z.string().url().nullable(),
    jobType: adminRefreshJobTypeSchema,
    reason: adminRefreshJobReasonSchema,
    status: adminRefreshJobStatusSchema,
    priority: z.number().int(),
    attemptCount: z.number().int().nonnegative(),
    lastError: z.string().nullable(),
    runAfter: isoTimestampSchema,
    startedAt: isoTimestampSchema.nullable(),
    finishedAt: isoTimestampSchema.nullable(),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema
  })
  .strict();

export type AdminJobSummary = z.infer<typeof adminJobSummarySchema>;

export const adminSourceHealthSchema = z
  .object({
    sourceId: z.string().min(1),
    displayName: z.string().min(1),
    enabled: z.boolean(),
    allowedUrlPatterns: z.array(z.string().min(1)),
    defaultTtlSeconds: z.number().int().positive(),
    pageCount: z.number().int().nonnegative(),
    chunkCount: z.number().int().nonnegative(),
    embeddingCount: z.number().int().nonnegative(),
    embeddedChunkCount: z.number().int().nonnegative(),
    embeddingCoverage: rateSchema,
    stalePages: z.number().int().nonnegative(),
    tombstonedPages: z.number().int().nonnegative(),
    oldestFetchedPage: isoTimestampSchema.nullable(),
    newestIndexedPage: isoTimestampSchema.nullable(),
    latestSuccessfulJob: adminJobSummarySchema.nullable(),
    latestFailedJob: adminJobSummarySchema.nullable()
  })
  .strict();

export type AdminSourceHealth = z.infer<typeof adminSourceHealthSchema>;

export const adminPageListItemSchema = z
  .object({
    id: z.number().int().nonnegative(),
    sourceId: z.string().min(1),
    url: z.string().url(),
    canonicalUrl: z.string().url(),
    title: z.string(),
    httpStatus: z.number().int().min(100).max(599),
    contentHash: z.string().min(1),
    freshness: adminPageFreshnessSchema,
    fetchedAt: isoTimestampSchema,
    indexedAt: isoTimestampSchema,
    expiresAt: isoTimestampSchema.nullable(),
    tombstonedAt: isoTimestampSchema.nullable(),
    tombstoneReason: z.string().nullable(),
    chunkCount: z.number().int().nonnegative(),
    embeddingCount: z.number().int().nonnegative(),
    hasEmbedding: z.boolean()
  })
  .strict();

export type AdminPageListItem = z.infer<typeof adminPageListItemSchema>;

export const adminPageChunkSummarySchema = z
  .object({
    id: z.number().int().nonnegative(),
    chunkIndex: z.number().int().nonnegative(),
    headingPath: z.array(z.string()),
    tokenEstimate: z.number().int().nonnegative(),
    contentHash: z.string().min(1),
    embeddingCount: z.number().int().nonnegative(),
    hasEmbedding: z.boolean()
  })
  .strict();

export const adminPageDetailSchema = adminPageListItemSchema
  .extend({
    content: z.string(),
    chunks: z.array(adminPageChunkSummarySchema)
  })
  .strict();

export type AdminPageDetail = z.infer<typeof adminPageDetailSchema>;

export const adminChunkDetailSchema = z
  .object({
    id: z.number().int().nonnegative(),
    sourceId: z.string().min(1),
    pageId: z.number().int().nonnegative(),
    pageTitle: z.string(),
    pageUrl: z.string().url(),
    pageCanonicalUrl: z.string().url(),
    pageTombstonedAt: isoTimestampSchema.nullable(),
    title: z.string(),
    headingPath: z.array(z.string()),
    chunkIndex: z.number().int().nonnegative(),
    content: z.string(),
    contentHash: z.string().min(1),
    tokenEstimate: z.number().int().nonnegative(),
    embeddingCount: z.number().int().nonnegative(),
    hasEmbedding: z.boolean(),
    previousChunkId: z.number().int().nonnegative().nullable(),
    nextChunkId: z.number().int().nonnegative().nullable(),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema
  })
  .strict();

export type AdminChunkDetail = z.infer<typeof adminChunkDetailSchema>;

export const adminAuditEventSchema = z
  .object({
    id: z.number().int().nonnegative(),
    actorUserId: z.number().int().nonnegative().nullable(),
    eventType: z.string().min(1),
    targetType: z.string().nullable(),
    targetId: z.string().nullable(),
    details: z.record(z.string(), z.unknown()),
    createdAt: isoTimestampSchema
  })
  .strict();

export const adminAuditEventsResultSchema = z.discriminatedUnion("available", [
  z
    .object({
      available: z.literal(true),
      items: z.array(adminAuditEventSchema),
      nextCursor: z.number().int().nonnegative().nullable()
    })
    .strict(),
  z
    .object({
      available: z.literal(false),
      items: z.array(z.never()).length(0),
      nextCursor: z.null(),
      reason: z.string().min(1)
    })
    .strict()
]);

export type AdminAuditEventsResult = z.infer<typeof adminAuditEventsResultSchema>;

export const adminSourcesResponseSchema = z
  .object({
    ok: z.literal(true),
    sources: z.array(adminSourceHealthSchema)
  })
  .strict();

export const adminSourceResponseSchema = z
  .object({
    ok: z.literal(true),
    source: adminSourceHealthSchema
  })
  .strict();

export const adminOverviewResponseSchema = z
  .object({
    ok: z.literal(true),
    overview: adminOverviewKpisSchema
  })
  .strict();

export const adminKpisResponseSchema = z
  .object({
    ok: z.literal(true),
    kpis: adminRetrievalKpisSchema
  })
  .strict();

export const adminPagesResponseSchema = z
  .object({
    ok: z.literal(true),
    pages: z.array(adminPageListItemSchema),
    nextCursor: z.number().int().nonnegative().nullable()
  })
  .strict();

export const adminPageResponseSchema = z
  .object({
    ok: z.literal(true),
    page: adminPageDetailSchema
  })
  .strict();

export const adminChunkResponseSchema = z
  .object({
    ok: z.literal(true),
    chunk: adminChunkDetailSchema
  })
  .strict();

export const adminJobsResponseSchema = z
  .object({
    ok: z.literal(true),
    jobs: z.array(adminJobSummarySchema),
    nextCursor: z.number().int().nonnegative().nullable()
  })
  .strict();

export const adminJobResponseSchema = z
  .object({
    ok: z.literal(true),
    job: adminJobSummarySchema
  })
  .strict();

export const adminActionTypeSchema = z.enum(["source_refresh", "job_retry", "source_tombstone", "source_purge_reindex"]);
export const adminActionStatusSchema = z.enum(["queued", "deduplicated", "skipped_bounds", "retried", "tombstoned", "purge_reindex_queued"]);

export const adminConfirmedSourceActionRequestSchema = z
  .object({
    confirmation: z.string().min(1),
    reason: z.string().min(1).max(500).optional()
  })
  .strict();

export type AdminConfirmedSourceActionRequest = z.infer<typeof adminConfirmedSourceActionRequestSchema>;

export const adminActionResultSchema = z
  .object({
    actionType: adminActionTypeSchema,
    status: adminActionStatusSchema,
    sourceId: z.string().min(1).nullable(),
    jobId: z.number().int().nonnegative().nullable(),
    queuedJobId: z.number().int().nonnegative().nullable(),
    affectedPages: z.number().int().nonnegative().nullable(),
    auditEventId: z.number().int().nonnegative().nullable(),
    message: z.string().min(1)
  })
  .strict();

export type AdminActionResult = z.infer<typeof adminActionResultSchema>;

export const adminActionResponseSchema = z
  .object({
    ok: z.literal(true),
    action: adminActionResultSchema
  })
  .strict();

export type AdminActionResponse = z.infer<typeof adminActionResponseSchema>;

export const adminAuditEventsResponseSchema = z
  .object({
    ok: z.literal(true),
    audit: adminAuditEventsResultSchema
  })
  .strict();

export const adminSearchRequestSchema = z
  .object({
    query: z.string().min(1),
    sourceId: z.string().min(1).optional(),
    mode: adminRetrievalModeSchema.optional(),
    limit: z.number().int().min(1).max(100).optional(),
    forceRefresh: z.boolean().optional()
  })
  .strict();

export type AdminSearchRequest = z.infer<typeof adminSearchRequestSchema>;

export const adminSourceCitationSchema = z
  .object({
    title: z.string().min(1),
    url: z.string().url(),
    sourceType: z.string().min(1),
    fetchedAt: isoTimestampSchema.optional(),
    contentHash: z.string().min(1).optional()
  })
  .strict();

export const adminSearchResultItemSchema = z
  .object({
    chunkId: z.number().int().nonnegative(),
    pageId: z.number().int().nonnegative(),
    title: z.string(),
    url: z.string().url(),
    headingPath: z.array(z.string()),
    snippet: z.string(),
    score: z.number(),
    keywordScore: z.number(),
    vectorScore: z.number(),
    rerankScore: z.number(),
    fetchedAt: isoTimestampSchema,
    indexedAt: isoTimestampSchema,
    contentHash: z.string().min(1)
  })
  .strict();

export const adminSearchWarningSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
    details: z.record(z.string(), z.unknown()).optional()
  })
  .strict();

export const adminSearchRetrievalMetadataSchema = z
  .object({
    mode: adminRetrievalModeSchema,
    keywordAttempted: z.boolean(),
    vectorAttempted: z.boolean(),
    keywordResultCount: z.number().int().nonnegative(),
    vectorResultCount: z.number().int().nonnegative(),
    mergedResultCount: z.number().int().nonnegative(),
    queryHash: z.string().min(1)
  })
  .strict();

export const adminSearchResponseSchema = z
  .object({
    ok: z.literal(true),
    generatedAt: isoTimestampSchema,
    query: z.string(),
    sourceId: z.string().min(1),
    mode: adminRetrievalModeSchema,
    limit: z.number().int().positive(),
    results: z.array(adminSearchResultItemSchema),
    sources: z.array(adminSourceCitationSchema),
    freshness: adminDocsFreshnessSchema,
    confidence: adminRetrievalConfidenceSchema,
    refreshQueued: z.boolean(),
    refreshReason: z.enum(["missing_content", "stale_content", "low_confidence", "manual"]).optional(),
    retrieval: adminSearchRetrievalMetadataSchema,
    warnings: z.array(adminSearchWarningSchema)
  })
  .strict();

export type AdminSearchResponse = z.infer<typeof adminSearchResponseSchema>;

