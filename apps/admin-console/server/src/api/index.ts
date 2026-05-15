import { Hono, type Context } from "hono";
import { getCookie } from "hono/cookie";
import {
  adminActionResponseSchema,
  adminConfirmedSourceActionRequestSchema,
  adminAuditEventsResponseSchema,
  adminAuthUserResponseSchema,
  adminChunkResponseSchema,
  adminErrorResponseSchema,
  adminJobResponseSchema,
  adminJobsResponseSchema,
  adminKpisResponseSchema,
  adminKpiWindowSchema,
  adminLoginRequestSchema,
  adminLogoutResponseSchema,
  adminOverviewResponseSchema,
  adminPageFreshnessSchema,
  adminPageResponseSchema,
  adminPagesResponseSchema,
  adminRefreshJobReasonSchema,
  adminRefreshJobStatusSchema,
  adminRefreshJobTypeSchema,
  adminSearchRequestSchema,
  adminSearchResponseSchema,
  adminSourceResponseSchema,
  adminSourcesResponseSchema,
  type AdminErrorResponse,
  type AdminSearchRequest,
  type AdminSearchResponse
} from "@bun-dev-intel/admin-contracts";
import { isAdminActionError, type AdminActionService } from "../actions";
import {
  adminSessionCookieName,
  createAdminAuthMiddleware,
  createAdminSession,
  createAdminSessionCookie,
  createClearAdminSessionCookie,
  hashSessionToken,
  verifyAdminPassword,
  type AdminAuthStore,
  type AdminAuthUser,
  type AdminPrincipal
} from "../auth";
import type {
  AdminAuditEventsResult,
  AdminChunkDetail,
  AdminJobListFilters,
  AdminJobSummary,
  AdminOverviewKpis,
  AdminPageDetail,
  AdminPageListFilters,
  AdminPageListItem,
  AdminSourceHealth,
  PaginatedResult,
  RetrievalKpis
} from "../read-models";

type AdminApiStatus = 400 | 401 | 403 | 404 | 429 | 500 | 503;

interface LoginRateLimiter {
  readonly isLimited: (key: string) => boolean;
  readonly recordFailure: (key: string) => void;
  readonly clear: (key: string) => void;
}

export interface AdminApiAuthStore extends AdminAuthStore {
  readonly getUserByEmail: (email: string) => Promise<AdminAuthUser | null>;
}

export interface AdminReadModels {
  readonly getOverview: (input: { readonly window: "1h" | "24h" | "7d" | "30d"; readonly now: string }) => Promise<AdminOverviewKpis>;
  readonly getRetrievalKpis: (input: { readonly window: "1h" | "24h" | "7d" | "30d"; readonly now: string }) => Promise<RetrievalKpis>;
  readonly listSourceHealth: (now: string) => Promise<readonly AdminSourceHealth[]>;
  readonly getSourceHealth: (input: { readonly sourceId: string; readonly now: string }) => Promise<AdminSourceHealth | null>;
  readonly listPages: (input: AdminPageListFilters) => Promise<PaginatedResult<AdminPageListItem>>;
  readonly getPageDetail: (input: { readonly sourceId: string; readonly pageId: number; readonly now: string }) => Promise<AdminPageDetail | null>;
  readonly getChunkDetail: (input: { readonly sourceId: string; readonly chunkId: number }) => Promise<AdminChunkDetail | null>;
  readonly listJobs: (input?: AdminJobListFilters) => Promise<PaginatedResult<AdminJobSummary>>;
  readonly getJobDetail: (jobId: number) => Promise<AdminJobSummary | null>;
  readonly listAuditEvents: (input?: { readonly limit?: number; readonly cursor?: number }) => Promise<AdminAuditEventsResult>;
}

export interface AdminSearchService {
  readonly search: (input: AdminSearchRequest) => Promise<AdminSearchResponse | AdminErrorResponse>;
}

export interface AdminApiOptions {
  readonly authStore: AdminApiAuthStore;
  readonly readModels: AdminReadModels;
  readonly searchService: AdminSearchService;
  readonly actionService?: AdminActionService;
  readonly now: () => string;
  readonly sessionTtlSeconds?: number;
  readonly secureCookies?: boolean;
  readonly loginRateLimiter?: LoginRateLimiter;
}

type AdminApiEnv = {
  Variables: {
    adminUser: AdminPrincipal;
  };
};

function errorBody(status: AdminApiStatus, code: string, message: string): AdminErrorResponse {
  return adminErrorResponseSchema.parse({
    ok: false,
    error: {
      code,
      message,
      status
    }
  });
}

function jsonError(context: Context, status: AdminApiStatus, code: string, message: string): Response {
  return context.json(errorBody(status, code, message), status);
}

function validationError(context: Context, message = "Invalid admin API request."): Response {
  return jsonError(context, 400, "invalid_input", message);
}

function notFound(context: Context, message: string): Response {
  return jsonError(context, 404, "not_found", message);
}

function forbidden(context: Context): Response {
  return jsonError(context, 403, "forbidden", "Admin role is required.");
}

function requestIp(context: Context): string {
  return context.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

function loginRateLimitKey(context: Context, email: string): string {
  return `${email.trim().toLowerCase()}:${requestIp(context)}`;
}

async function parseJsonBody(context: Context): Promise<unknown | null> {
  try {
    return await context.req.json();
  } catch {
    return null;
  }
}

function optionalIntegerQuery(context: Context, name: string): number | undefined | "invalid" {
  const raw = context.req.query(name);

  if (raw === undefined || raw.length === 0) {
    return undefined;
  }

  const value = Number(raw);
  return Number.isInteger(value) ? value : "invalid";
}

function requiredIntegerParam(context: Context, name: string): number | "invalid" {
  const raw = context.req.param(name);
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : "invalid";
}

function optionalBooleanQuery(context: Context, name: string): boolean | undefined | "invalid" {
  const raw = context.req.query(name);

  if (raw === undefined || raw.length === 0) {
    return undefined;
  }

  if (raw === "true") {
    return true;
  }

  if (raw === "false") {
    return false;
  }

  return "invalid";
}

function parseWindow(context: Context): "1h" | "24h" | "7d" | "30d" | "invalid" {
  const parsed = adminKpiWindowSchema.safeParse(context.req.query("window") ?? "24h");
  return parsed.success ? parsed.data : "invalid";
}

function parseLimitCursor(context: Context): { readonly limit?: number; readonly cursor?: number } | "invalid" {
  const limit = optionalIntegerQuery(context, "limit");
  const cursor = optionalIntegerQuery(context, "cursor");

  if (limit === "invalid" || cursor === "invalid") {
    return "invalid";
  }

  return {
    ...(limit === undefined ? {} : { limit }),
    ...(cursor === undefined ? {} : { cursor })
  };
}

function parsePagesQuery(context: Context, sourceId: string, now: string): AdminPageListFilters | "invalid" {
  const pagination = parseLimitCursor(context);
  const freshnessRaw = context.req.query("freshness");
  const freshness = freshnessRaw === undefined ? undefined : adminPageFreshnessSchema.safeParse(freshnessRaw);
  const hasEmbedding = optionalBooleanQuery(context, "hasEmbedding");

  if (pagination === "invalid" || hasEmbedding === "invalid" || freshness?.success === false) {
    return "invalid";
  }

  return {
    sourceId,
    now,
    ...pagination,
    ...(context.req.query("q") === undefined ? {} : { q: context.req.query("q") }),
    ...(freshness === undefined ? {} : { freshness: freshness.data }),
    ...(hasEmbedding === undefined ? {} : { hasEmbedding })
  };
}

function parseJobsQuery(context: Context, now: string): AdminJobListFilters | "invalid" {
  const pagination = parseLimitCursor(context);
  const statusRaw = context.req.query("status");
  const jobTypeRaw = context.req.query("jobType");
  const reasonRaw = context.req.query("reason");
  const windowRaw = context.req.query("window");
  const status = statusRaw === undefined ? undefined : adminRefreshJobStatusSchema.safeParse(statusRaw);
  const jobType = jobTypeRaw === undefined ? undefined : adminRefreshJobTypeSchema.safeParse(jobTypeRaw);
  const reason = reasonRaw === undefined ? undefined : adminRefreshJobReasonSchema.safeParse(reasonRaw);
  const window = windowRaw === undefined ? undefined : adminKpiWindowSchema.safeParse(windowRaw);

  if (pagination === "invalid" || status?.success === false || jobType?.success === false || reason?.success === false || window?.success === false) {
    return "invalid";
  }

  return {
    ...pagination,
    ...(context.req.query("sourceId") === undefined ? {} : { sourceId: context.req.query("sourceId") }),
    ...(status === undefined ? {} : { status: status.data }),
    ...(jobType === undefined ? {} : { jobType: jobType.data }),
    ...(reason === undefined ? {} : { reason: reason.data }),
    ...(context.req.query("urlContains") === undefined ? {} : { urlContains: context.req.query("urlContains") }),
    ...(window === undefined ? {} : { window: window.data, now })
  };
}

function requireAdminActionService(context: Context, options: AdminApiOptions): AdminActionService | Response {
  if (context.get("adminUser").role !== "admin") {
    return forbidden(context);
  }

  if (options.actionService === undefined) {
    return jsonError(context, 503, "admin_actions_unavailable", "Admin actions are not configured.");
  }

  return options.actionService;
}

function adminActionError(context: Context, error: unknown): Response {
  if (isAdminActionError(error)) {
    return jsonError(context, error.status, error.code, error.message);
  }

  throw error;
}

export function createAdminApiRoutes(options: AdminApiOptions): Hono<AdminApiEnv> {
  const app = new Hono<AdminApiEnv>();
  const sessionTtlSeconds = options.sessionTtlSeconds ?? 8 * 60 * 60;
  const secureCookies = options.secureCookies ?? false;

  app.post("/auth/login", async (context) => {
    const rawBody = await parseJsonBody(context);
    const parsed = adminLoginRequestSchema.safeParse(rawBody);

    if (!parsed.success) {
      return validationError(context);
    }

    const limiterKey = loginRateLimitKey(context, parsed.data.email);

    if (options.loginRateLimiter?.isLimited(limiterKey) === true) {
      return jsonError(context, 429, "rate_limited", "Too many login attempts.");
    }

    const user = await options.authStore.getUserByEmail(parsed.data.email);
    const validPassword = user === null ? false : await verifyAdminPassword(parsed.data.password, user.passwordHash);

    if (user === null || user.disabledAt !== null || !validPassword) {
      options.loginRateLimiter?.recordFailure(limiterKey);
      return jsonError(context, 401, "invalid_credentials", "Invalid email or password.");
    }

    options.loginRateLimiter?.clear(limiterKey);
    const created = await createAdminSession({
      store: options.authStore,
      userId: user.id,
      now: options.now,
      ttlSeconds: sessionTtlSeconds,
      userAgent: context.req.header("user-agent"),
      ip: requestIp(context)
    });

    context.header("Set-Cookie", createAdminSessionCookie({ token: created.token, expiresAt: created.session.expiresAt, secure: secureCookies }));

    return context.json(
      adminAuthUserResponseSchema.parse({
        ok: true,
        user: {
          id: created.session.userId,
          email: created.session.email,
          role: created.session.role
        }
      })
    );
  });

  app.use("*", createAdminAuthMiddleware({ store: options.authStore, now: options.now }));

  app.post("/auth/logout", async (context) => {
    const token = getCookie(context, adminSessionCookieName);

    if (token !== undefined) {
      await options.authStore.revokeSession(hashSessionToken(token), options.now());
    }

    context.header("Set-Cookie", createClearAdminSessionCookie({ secure: secureCookies }));
    return context.json(adminLogoutResponseSchema.parse({ ok: true }));
  });

  app.get("/auth/me", (context) =>
    context.json(
      adminAuthUserResponseSchema.parse({
        ok: true,
        user: context.get("adminUser")
      })
    )
  );

  app.get("/overview", async (context) => {
    const window = parseWindow(context);

    if (window === "invalid") {
      return validationError(context, "Invalid window query parameter.");
    }

    const overview = await options.readModels.getOverview({ window, now: options.now() });
    return context.json(adminOverviewResponseSchema.parse({ ok: true, overview }));
  });

  app.get("/kpis", async (context) => {
    const window = parseWindow(context);

    if (window === "invalid") {
      return validationError(context, "Invalid window query parameter.");
    }

    const kpis = await options.readModels.getRetrievalKpis({ window, now: options.now() });
    return context.json(adminKpisResponseSchema.parse({ ok: true, kpis }));
  });

  app.get("/sources", async (context) => {
    const sources = await options.readModels.listSourceHealth(options.now());
    return context.json(adminSourcesResponseSchema.parse({ ok: true, sources }));
  });

  app.get("/sources/:sourceId", async (context) => {
    const source = await options.readModels.getSourceHealth({ sourceId: context.req.param("sourceId"), now: options.now() });

    if (source === null) {
      return notFound(context, "Source was not found.");
    }

    return context.json(adminSourceResponseSchema.parse({ ok: true, source }));
  });

  app.post("/sources/:sourceId/actions/refresh", async (context) => {
    const actionService = requireAdminActionService(context, options);

    if (actionService instanceof Response) {
      return actionService;
    }

    try {
      const action = await actionService.refreshSource({
        sourceId: context.req.param("sourceId"),
        actor: context.get("adminUser"),
        now: options.now()
      });
      return context.json(adminActionResponseSchema.parse({ ok: true, action }));
    } catch (error) {
      return adminActionError(context, error);
    }
  });

  app.post("/sources/:sourceId/actions/tombstone", async (context) => {
    const actionService = requireAdminActionService(context, options);

    if (actionService instanceof Response) {
      return actionService;
    }

    const rawBody = await parseJsonBody(context);
    const parsed = adminConfirmedSourceActionRequestSchema.safeParse(rawBody);

    if (!parsed.success) {
      return validationError(context, "Invalid source action request.");
    }

    try {
      const action = await actionService.tombstoneSource({
        sourceId: context.req.param("sourceId"),
        confirmation: parsed.data.confirmation,
        ...(parsed.data.reason === undefined ? {} : { reason: parsed.data.reason }),
        actor: context.get("adminUser"),
        now: options.now()
      });
      return context.json(adminActionResponseSchema.parse({ ok: true, action }));
    } catch (error) {
      return adminActionError(context, error);
    }
  });

  app.post("/sources/:sourceId/actions/purge-reindex", async (context) => {
    const actionService = requireAdminActionService(context, options);

    if (actionService instanceof Response) {
      return actionService;
    }

    const rawBody = await parseJsonBody(context);
    const parsed = adminConfirmedSourceActionRequestSchema.safeParse(rawBody);

    if (!parsed.success) {
      return validationError(context, "Invalid source action request.");
    }

    try {
      const action = await actionService.purgeReindexSource({
        sourceId: context.req.param("sourceId"),
        confirmation: parsed.data.confirmation,
        actor: context.get("adminUser"),
        now: options.now()
      });
      return context.json(adminActionResponseSchema.parse({ ok: true, action }));
    } catch (error) {
      return adminActionError(context, error);
    }
  });

  app.get("/sources/:sourceId/pages", async (context) => {
    const query = parsePagesQuery(context, context.req.param("sourceId"), options.now());

    if (query === "invalid") {
      return validationError(context, "Invalid page list query parameter.");
    }

    const result = await options.readModels.listPages(query);
    return context.json(adminPagesResponseSchema.parse({ ok: true, pages: result.items, nextCursor: result.nextCursor }));
  });

  app.get("/sources/:sourceId/pages/:pageId", async (context) => {
    const pageId = requiredIntegerParam(context, "pageId");

    if (pageId === "invalid") {
      return validationError(context, "Invalid page ID.");
    }

    const page = await options.readModels.getPageDetail({ sourceId: context.req.param("sourceId"), pageId, now: options.now() });

    if (page === null) {
      return notFound(context, "Page was not found.");
    }

    return context.json(adminPageResponseSchema.parse({ ok: true, page }));
  });

  app.get("/sources/:sourceId/chunks/:chunkId", async (context) => {
    const chunkId = requiredIntegerParam(context, "chunkId");

    if (chunkId === "invalid") {
      return validationError(context, "Invalid chunk ID.");
    }

    const chunk = await options.readModels.getChunkDetail({ sourceId: context.req.param("sourceId"), chunkId });

    if (chunk === null) {
      return notFound(context, "Chunk was not found.");
    }

    return context.json(adminChunkResponseSchema.parse({ ok: true, chunk }));
  });

  app.get("/jobs", async (context) => {
    const query = parseJobsQuery(context, options.now());

    if (query === "invalid") {
      return validationError(context, "Invalid job list query parameter.");
    }

    const result = await options.readModels.listJobs(query);
    return context.json(adminJobsResponseSchema.parse({ ok: true, jobs: result.items, nextCursor: result.nextCursor }));
  });

  app.get("/jobs/:jobId", async (context) => {
    const jobId = requiredIntegerParam(context, "jobId");

    if (jobId === "invalid") {
      return validationError(context, "Invalid job ID.");
    }

    const job = await options.readModels.getJobDetail(jobId);

    if (job === null) {
      return notFound(context, "Job was not found.");
    }

    return context.json(adminJobResponseSchema.parse({ ok: true, job }));
  });

  app.post("/jobs/:jobId/actions/retry", async (context) => {
    const actionService = requireAdminActionService(context, options);

    if (actionService instanceof Response) {
      return actionService;
    }

    const jobId = requiredIntegerParam(context, "jobId");

    if (jobId === "invalid") {
      return validationError(context, "Invalid job ID.");
    }

    try {
      const action = await actionService.retryJob({
        jobId,
        actor: context.get("adminUser"),
        now: options.now()
      });
      return context.json(adminActionResponseSchema.parse({ ok: true, action }));
    } catch (error) {
      return adminActionError(context, error);
    }
  });

  app.post("/search", async (context) => {
    const rawBody = await parseJsonBody(context);
    const parsed = adminSearchRequestSchema.safeParse(rawBody);

    if (!parsed.success) {
      return validationError(context, "Invalid search request.");
    }

    const result = await options.searchService.search(parsed.data);

    if (!result.ok) {
      return context.json(adminErrorResponseSchema.parse(result), result.error.status as AdminApiStatus);
    }

    return context.json(adminSearchResponseSchema.parse(result));
  });

  app.get("/audit-events", async (context) => {
    const pagination = parseLimitCursor(context);

    if (pagination === "invalid") {
      return validationError(context, "Invalid audit list query parameter.");
    }

    const audit = await options.readModels.listAuditEvents(pagination);
    return context.json(adminAuditEventsResponseSchema.parse({ ok: true, audit }));
  });

  return app;
}
