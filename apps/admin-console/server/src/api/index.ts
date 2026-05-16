import { createHash, randomUUID } from "node:crypto";
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
import {
  isAdminActionError,
  type AdminActionAuditEvent,
  type AdminActionAuditInput,
  type AdminActionService
} from "../actions";
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
import { noopAdminAuthLogger, type AdminAuthLogger } from "../auth/logging";
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

interface AdminAuditWriter {
  readonly createAuditEvent: (input: AdminActionAuditInput) => Promise<AdminActionAuditEvent>;
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
  readonly auditStore?: AdminAuditWriter;
  readonly now: () => string;
  readonly sessionTtlSeconds?: number;
  readonly secureCookies?: boolean;
  readonly loginRateLimiter?: LoginRateLimiter;
  readonly authLogger?: AdminAuthLogger;
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

function normalizedLoginEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hashLogValue(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function maskedEmail(email: string): string {
  const normalized = normalizedLoginEmail(email);
  const [local = "", domain = ""] = normalized.split("@");

  if (local.length === 0 || domain.length === 0) {
    return normalized.length === 0 ? "[empty]" : "[invalid-email]";
  }

  return `${local[0]}***@${domain}`;
}

function loginIdentityFields(email: string): Record<string, unknown> {
  const normalized = normalizedLoginEmail(email);
  const domain = normalized.includes("@") ? normalized.split("@").at(-1) : null;

  return {
    emailPresent: normalized.length > 0,
    emailMasked: maskedEmail(email),
    emailHash: hashLogValue(normalized),
    emailDomain: domain
  };
}

function requestId(context: Context): string {
  const headerValue = context.req.header("x-request-id")?.trim();
  return headerValue === undefined || headerValue.length === 0 ? randomUUID() : headerValue.slice(0, 128);
}

function requestLogFields(context: Context, id: string): Record<string, unknown> {
  return {
    requestId: id,
    method: context.req.method,
    path: new URL(context.req.url).pathname,
    ip: requestIp(context),
    userAgent: context.req.header("user-agent") ?? null
  };
}

function setRequestIdHeader(context: Context, id: string): void {
  context.header("x-request-id", id);
}

function safeRequestHeaders(context: Context): Record<string, unknown> {
  return {
    contentType: context.req.header("content-type") ?? null,
    contentLength: context.req.header("content-length") ?? null,
    origin: context.req.header("origin") ?? null,
    referer: context.req.header("referer") ?? null,
    xForwardedForPresent: context.req.header("x-forwarded-for") !== undefined,
    xRequestIdPresent: context.req.header("x-request-id") !== undefined,
    cookiePresent: context.req.header("cookie") !== undefined,
    authorizationPresent: context.req.header("authorization") !== undefined
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function loginBodySummary(rawBody: unknown): Record<string, unknown> {
  if (!isRecord(rawBody)) {
    return {
      bodyType: rawBody === null ? "null" : Array.isArray(rawBody) ? "array" : typeof rawBody
    };
  }

  const keys = Object.keys(rawBody);
  const email = typeof rawBody.email === "string" ? rawBody.email : "";
  const password = rawBody.password;

  return {
    bodyType: "object",
    keys,
    ...loginIdentityFields(email),
    passwordPresent: typeof password === "string" && password.length > 0,
    passwordType: password === null ? "null" : typeof password,
    unexpectedKeys: keys.filter((key) => key !== "email" && key !== "password")
  };
}

function validationIssueSummary(parsed: ReturnType<typeof adminLoginRequestSchema.safeParse>): readonly Record<string, unknown>[] {
  if (parsed.success) {
    return [];
  }

  return parsed.error.issues.map((issue) => ({
    path: issue.path.join("."),
    code: issue.code,
    message: issue.message
  }));
}

function loginFailureReason(input: { readonly user: AdminAuthUser | null; readonly validPassword: boolean }): "user_not_found" | "user_disabled" | "invalid_password" {
  if (input.user === null) {
    return "user_not_found";
  }

  if (input.user.disabledAt !== null) {
    return "user_disabled";
  }

  if (!input.validPassword) {
    return "invalid_password";
  }

  return "invalid_password";
}

function durationMs(startedAtMs: number): number {
  return Date.now() - startedAtMs;
}

async function recordAuthAudit(
  options: AdminApiOptions,
  input: {
    readonly actorUserId: number | null;
    readonly email: string;
    readonly eventType: "admin.auth.login_succeeded" | "admin.auth.login_failed" | "admin.auth.login_rate_limited";
    readonly status: "succeeded" | "failed" | "rate_limited";
    readonly context: Context;
    readonly now: string;
  }
): Promise<"written" | "skipped"> {
  if (options.auditStore === undefined) {
    return "skipped";
  }

  await options.auditStore.createAuditEvent({
    actorUserId: input.actorUserId,
    eventType: input.eventType,
    targetType: "admin_user",
    targetId: input.actorUserId === null ? normalizedLoginEmail(input.email) : String(input.actorUserId),
    now: input.now,
    details: {
      email: normalizedLoginEmail(input.email),
      status: input.status,
      ip: requestIp(input.context),
      userAgent: input.context.req.header("user-agent") ?? null
    }
  });
  return "written";
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
  const authLogger = options.authLogger ?? noopAdminAuthLogger;

  app.post("/auth/login", async (context) => {
    const id = requestId(context);
    const fields = requestLogFields(context, id);
    const startedAtMs = Date.now();
    setRequestIdHeader(context, id);

    authLogger.info("login.request.received", {
      ...fields
    });
    authLogger.trace("login.request.headers", {
      ...fields,
      headers: safeRequestHeaders(context)
    });

    const rawBody = await parseJsonBody(context);
    authLogger.trace("login.request.body_parsed", {
      ...fields,
      body: loginBodySummary(rawBody)
    });

    const parsed = adminLoginRequestSchema.safeParse(rawBody);

    if (!parsed.success) {
      authLogger.info("login.request.rejected", {
        ...fields,
        status: 400,
        reason: "invalid_payload",
        durationMs: durationMs(startedAtMs)
      });
      authLogger.debug("login.validation.failed", {
        ...fields,
        issues: validationIssueSummary(parsed)
      });
      return validationError(context);
    }

    authLogger.debug("login.input.validated", {
      ...fields,
      ...loginIdentityFields(parsed.data.email),
      passwordPresent: parsed.data.password.length > 0
    });

    const limiterKey = loginRateLimitKey(context, parsed.data.email);
    const attemptedAt = options.now();
    const limiterKeyHash = hashLogValue(limiterKey);
    const limited = options.loginRateLimiter?.isLimited(limiterKey) === true;

    authLogger.trace("login.rate_limit.key_derived", {
      ...fields,
      limiterKeyHash
    });
    authLogger.debug("login.rate_limit.checked", {
      ...fields,
      limiterKeyHash,
      limited
    });

    if (limited) {
      const auditStatus = await recordAuthAudit(options, {
        actorUserId: null,
        email: parsed.data.email,
        eventType: "admin.auth.login_rate_limited",
        status: "rate_limited",
        context,
        now: attemptedAt
      });
      authLogger.info("login.rate_limited", {
        ...fields,
        ...loginIdentityFields(parsed.data.email),
        status: 429,
        auditStatus,
        durationMs: durationMs(startedAtMs)
      });
      return jsonError(context, 429, "rate_limited", "Too many login attempts.");
    }

    authLogger.debug("login.user_lookup.started", {
      ...fields,
      ...loginIdentityFields(parsed.data.email)
    });
    const user = await options.authStore.getUserByEmail(parsed.data.email);
    authLogger.debug("login.user_lookup.completed", {
      ...fields,
      userFound: user !== null,
      userId: user?.id ?? null,
      role: user?.role ?? null,
      disabled: user?.disabledAt !== null && user?.disabledAt !== undefined
    });

    authLogger.trace("login.password_verification.started", {
      ...fields,
      userFound: user !== null
    });
    const validPassword = user === null ? false : await verifyAdminPassword(parsed.data.password, user.passwordHash);
    authLogger.debug("login.password_verification.completed", {
      ...fields,
      userFound: user !== null,
      validPassword
    });

    if (user === null || user.disabledAt !== null || !validPassword) {
      options.loginRateLimiter?.recordFailure(limiterKey);
      authLogger.debug("login.rate_limit.failure_recorded", {
        ...fields,
        limiterKeyHash
      });
      const auditStatus = await recordAuthAudit(options, {
        actorUserId: user?.id ?? null,
        email: parsed.data.email,
        eventType: "admin.auth.login_failed",
        status: "failed",
        context,
        now: attemptedAt
      });
      authLogger.info("login.failed", {
        ...fields,
        ...loginIdentityFields(parsed.data.email),
        status: 401,
        reason: loginFailureReason({ user, validPassword }),
        userId: user?.id ?? null,
        role: user?.role ?? null,
        auditStatus,
        durationMs: durationMs(startedAtMs)
      });
      return jsonError(context, 401, "invalid_credentials", "Invalid email or password.");
    }

    options.loginRateLimiter?.clear(limiterKey);
    authLogger.debug("login.rate_limit.cleared", {
      ...fields,
      limiterKeyHash,
      userId: user.id
    });
    authLogger.trace("login.session.creation_started", {
      ...fields,
      userId: user.id,
      role: user.role,
      sessionTtlSeconds
    });
    const created = await createAdminSession({
      store: options.authStore,
      userId: user.id,
      now: () => attemptedAt,
      ttlSeconds: sessionTtlSeconds,
      userAgent: context.req.header("user-agent"),
      ip: requestIp(context)
    });
    authLogger.debug("login.session.created", {
      ...fields,
      userId: user.id,
      role: user.role,
      sessionId: created.session.id,
      expiresAt: created.session.expiresAt,
      secureCookies
    });
    const auditStatus = await recordAuthAudit(options, {
      actorUserId: user.id,
      email: user.email,
      eventType: "admin.auth.login_succeeded",
      status: "succeeded",
      context,
      now: attemptedAt
    });
    authLogger.debug("login.audit.recorded", {
      ...fields,
      eventType: "admin.auth.login_succeeded",
      auditStatus,
      userId: user.id
    });

    context.header("Set-Cookie", createAdminSessionCookie({ token: created.token, expiresAt: created.session.expiresAt, secure: secureCookies }));
    authLogger.trace("login.cookie.prepared", {
      ...fields,
      secureCookies,
      sameSite: "Lax",
      httpOnly: true,
      expiresAt: created.session.expiresAt
    });
    authLogger.info("login.succeeded", {
      ...fields,
      ...loginIdentityFields(user.email),
      status: 200,
      userId: created.session.userId,
      role: created.session.role,
      sessionId: created.session.id,
      durationMs: durationMs(startedAtMs)
    });

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

  app.use("*", createAdminAuthMiddleware({ store: options.authStore, now: options.now, logger: authLogger }));

  app.post("/auth/logout", async (context) => {
    const id = requestId(context);
    const fields = requestLogFields(context, id);
    const startedAtMs = Date.now();
    const user = context.get("adminUser");
    const token = getCookie(context, adminSessionCookieName);
    setRequestIdHeader(context, id);

    authLogger.info("logout.request.received", {
      ...fields,
      userId: user.id,
      role: user.role,
      cookiePresent: token !== undefined
    });

    let revoked = false;
    if (token !== undefined) {
      authLogger.trace("logout.session_revoke.started", {
        ...fields,
        userId: user.id
      });
      revoked = await options.authStore.revokeSession(hashSessionToken(token), options.now());
      authLogger.debug("logout.session_revoke.completed", {
        ...fields,
        userId: user.id,
        revoked
      });
    }

    context.header("Set-Cookie", createClearAdminSessionCookie({ secure: secureCookies }));
    authLogger.info("logout.succeeded", {
      ...fields,
      userId: user.id,
      role: user.role,
      revoked,
      secureCookies,
      durationMs: durationMs(startedAtMs)
    });
    return context.json(adminLogoutResponseSchema.parse({ ok: true }));
  });

  app.get("/auth/me", (context) => {
    const id = requestId(context);
    const fields = requestLogFields(context, id);
    const user = context.get("adminUser");
    setRequestIdHeader(context, id);

    authLogger.debug("session_check.me_returned", {
      ...fields,
      userId: user.id,
      role: user.role
    });

    return context.json(
      adminAuthUserResponseSchema.parse({
        ok: true,
        user
      })
    );
  });

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
