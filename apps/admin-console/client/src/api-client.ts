import {
  adminActionResponseSchema,
  adminAuthUserResponseSchema,
  adminChunkResponseSchema,
  adminConfirmedSourceActionRequestSchema,
  adminErrorResponseSchema,
  adminJobResponseSchema,
  adminKpisResponseSchema,
  adminJobsResponseSchema,
  adminLoginRequestSchema,
  adminLogoutResponseSchema,
  adminOverviewResponseSchema,
  adminPageResponseSchema,
  adminPagesResponseSchema,
  adminSearchRequestSchema,
  adminSearchResponseSchema,
  adminSourceResponseSchema,
  adminSourcesResponseSchema,
  type AdminActionResult,
  type AdminChunkDetail,
  type AdminConfirmedSourceActionRequest,
  type AdminErrorResponse,
  type AdminJobSummary,
  type AdminKpiWindow,
  type AdminLoginRequest,
  type AdminOverviewKpis,
  type AdminPageDetail,
  type AdminPageListItem,
  type AdminRetrievalKpis,
  type AdminSearchRequest,
  type AdminSearchResponse,
  type AdminSourceHealth,
  type AdminUser
} from "@bun-dev-intel/admin-contracts";

interface ResponseParser<T> {
  readonly safeParse: (value: unknown) => { readonly success: true; readonly data: T } | { readonly success: false; readonly error: unknown };
}

export class AdminApiClientError extends Error {
  constructor(readonly response: AdminErrorResponse, readonly requestId: string | null = null) {
    super(response.error.message);
    this.name = "AdminApiClientError";
  }
}

export type AdminApiUnexpectedResponseReason = "invalid_json" | "invalid_error_body" | "schema_mismatch";

export class AdminApiNetworkError extends Error {
  constructor(
    readonly request: {
      readonly path: string;
      readonly requestId: string;
      readonly cause: unknown;
    }
  ) {
    super(`Admin API request failed before a response was received: ${request.path}`);
    this.name = "AdminApiNetworkError";
  }
}

export class AdminApiUnexpectedResponseError extends Error {
  constructor(
    readonly response: {
      readonly path: string;
      readonly status: number;
      readonly contentType: string | null;
      readonly bodyKind: "empty" | "json" | "html" | "text";
      readonly requestId: string | null;
      readonly reason: AdminApiUnexpectedResponseReason;
    }
  ) {
    super(`Admin API returned an unexpected response for ${response.path}.`);
    this.name = "AdminApiUnexpectedResponseError";
  }
}

export interface AdminApiClientOptions {
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
  readonly createRequestId?: () => string;
}

export interface AdminJobListOptions {
  readonly sourceId?: string;
  readonly status?: AdminJobSummary["status"];
  readonly jobType?: AdminJobSummary["jobType"];
  readonly reason?: AdminJobSummary["reason"];
  readonly urlContains?: string;
  readonly window?: AdminKpiWindow;
  readonly limit?: number;
  readonly cursor?: number;
}

export interface AdminJobListResult {
  readonly jobs: readonly AdminJobSummary[];
  readonly nextCursor: number | null;
}

export interface AdminPageListOptions {
  readonly sourceId: string;
  readonly q?: string;
  readonly freshness?: AdminPageListItem["freshness"];
  readonly hasEmbedding?: boolean;
  readonly limit?: number;
  readonly cursor?: number;
}

export interface AdminPageListResult {
  readonly pages: readonly AdminPageListItem[];
  readonly nextCursor: number | null;
}

export class AdminApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly createRequestId: () => string;

  constructor(options: AdminApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? "";
    this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
    this.createRequestId = options.createRequestId ?? createRequestId;
  }

  async getMe(): Promise<AdminUser | null> {
    const response = await this.fetchJson("/api/admin/auth/me", adminAuthUserResponseSchema, {
      method: "GET"
    });

    return response.user;
  }

  async login(input: AdminLoginRequest): Promise<AdminUser> {
    const request = adminLoginRequestSchema.parse(input);
    const response = await this.fetchJson("/api/admin/auth/login", adminAuthUserResponseSchema, {
      method: "POST",
      body: JSON.stringify(request)
    });

    return response.user;
  }

  async logout(): Promise<void> {
    await this.fetchJson("/api/admin/auth/logout", adminLogoutResponseSchema, {
      method: "POST"
    });
  }

  async getOverview(window: AdminKpiWindow): Promise<AdminOverviewKpis> {
    const response = await this.fetchJson(`/api/admin/overview?window=${encodeURIComponent(window)}`, adminOverviewResponseSchema, {
      method: "GET"
    });

    return response.overview;
  }

  async getKpis(window: AdminKpiWindow): Promise<AdminRetrievalKpis> {
    const response = await this.fetchJson(`/api/admin/kpis?window=${encodeURIComponent(window)}`, adminKpisResponseSchema, {
      method: "GET"
    });

    return response.kpis;
  }

  async listSources(): Promise<readonly AdminSourceHealth[]> {
    const response = await this.fetchJson("/api/admin/sources", adminSourcesResponseSchema, {
      method: "GET"
    });

    return response.sources;
  }

  async getSource(sourceId: string): Promise<AdminSourceHealth> {
    const response = await this.fetchJson(`/api/admin/sources/${encodeURIComponent(sourceId)}`, adminSourceResponseSchema, {
      method: "GET"
    });

    return response.source;
  }

  async listPages(input: AdminPageListOptions): Promise<AdminPageListResult> {
    const response = await this.fetchJson(
      `/api/admin/sources/${encodeURIComponent(input.sourceId)}/pages${formatPageListQuery(input)}`,
      adminPagesResponseSchema,
      {
        method: "GET"
      }
    );

    return {
      pages: response.pages,
      nextCursor: response.nextCursor
    };
  }

  async getPage(sourceId: string, pageId: number): Promise<AdminPageDetail> {
    const response = await this.fetchJson(
      `/api/admin/sources/${encodeURIComponent(sourceId)}/pages/${encodeURIComponent(String(pageId))}`,
      adminPageResponseSchema,
      {
        method: "GET"
      }
    );

    return response.page;
  }

  async getChunk(sourceId: string, chunkId: number): Promise<AdminChunkDetail> {
    const response = await this.fetchJson(
      `/api/admin/sources/${encodeURIComponent(sourceId)}/chunks/${encodeURIComponent(String(chunkId))}`,
      adminChunkResponseSchema,
      {
        method: "GET"
      }
    );

    return response.chunk;
  }

  async listJobs(input: AdminJobListOptions = {}): Promise<AdminJobListResult> {
    const response = await this.fetchJson(`/api/admin/jobs${formatJobListQuery(input)}`, adminJobsResponseSchema, {
      method: "GET"
    });

    return {
      jobs: response.jobs,
      nextCursor: response.nextCursor
    };
  }

  async getJob(jobId: number): Promise<AdminJobSummary> {
    const response = await this.fetchJson(`/api/admin/jobs/${encodeURIComponent(String(jobId))}`, adminJobResponseSchema, {
      method: "GET"
    });

    return response.job;
  }

  async refreshSource(sourceId: string): Promise<AdminActionResult> {
    const response = await this.fetchJson(`/api/admin/sources/${encodeURIComponent(sourceId)}/actions/refresh`, adminActionResponseSchema, {
      method: "POST"
    });

    return response.action;
  }

  async retryJob(jobId: number): Promise<AdminActionResult> {
    const response = await this.fetchJson(`/api/admin/jobs/${encodeURIComponent(String(jobId))}/actions/retry`, adminActionResponseSchema, {
      method: "POST"
    });

    return response.action;
  }

  async tombstoneSource(sourceId: string, input: AdminConfirmedSourceActionRequest): Promise<AdminActionResult> {
    const request = adminConfirmedSourceActionRequestSchema.parse(input);
    const response = await this.fetchJson(`/api/admin/sources/${encodeURIComponent(sourceId)}/actions/tombstone`, adminActionResponseSchema, {
      method: "POST",
      body: JSON.stringify(request)
    });

    return response.action;
  }

  async purgeReindexSource(sourceId: string, input: Pick<AdminConfirmedSourceActionRequest, "confirmation">): Promise<AdminActionResult> {
    const request = adminConfirmedSourceActionRequestSchema.parse(input);
    const response = await this.fetchJson(`/api/admin/sources/${encodeURIComponent(sourceId)}/actions/purge-reindex`, adminActionResponseSchema, {
      method: "POST",
      body: JSON.stringify(request)
    });

    return response.action;
  }

  async search(input: AdminSearchRequest): Promise<AdminSearchResponse> {
    const request = adminSearchRequestSchema.parse(input);
    return this.fetchJson("/api/admin/search", adminSearchResponseSchema, {
      method: "POST",
      body: JSON.stringify(request)
    });
  }

  private async fetchJson<T>(path: string, parser: ResponseParser<T>, init: RequestInit): Promise<T> {
    const requestId = this.createRequestId();
    let response: Response;

    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        credentials: "include",
        headers: requestHeaders(init, requestId)
      });
    } catch (error) {
      throw new AdminApiNetworkError({ path, requestId, cause: error });
    }

    const responseRequestId = response.headers.get("x-request-id") ?? requestId;
    const parsedBody = await readJsonResponse(response);

    if (!response.ok) {
      const parsedError = adminErrorResponseSchema.safeParse(parsedBody.body);

      if (parsedError.success) {
        if (parsedError.data.error.code === "unauthorized" && path === "/api/admin/auth/me") {
          return { ok: true, user: null } as T;
        }

        throw new AdminApiClientError(parsedError.data, responseRequestId);
      }

      throw new AdminApiUnexpectedResponseError({
        path,
        status: response.status,
        contentType: parsedBody.contentType,
        bodyKind: parsedBody.bodyKind,
        requestId: responseRequestId,
        reason: parsedBody.parseFailed ? "invalid_json" : "invalid_error_body"
      });
    }

    if (parsedBody.parseFailed) {
      throw new AdminApiUnexpectedResponseError({
        path,
        status: response.status,
        contentType: parsedBody.contentType,
        bodyKind: parsedBody.bodyKind,
        requestId: responseRequestId,
        reason: "invalid_json"
      });
    }

    const parsedResponse = parser.safeParse(parsedBody.body);

    if (!parsedResponse.success) {
      throw new AdminApiUnexpectedResponseError({
        path,
        status: response.status,
        contentType: parsedBody.contentType,
        bodyKind: parsedBody.bodyKind,
        requestId: responseRequestId,
        reason: "schema_mismatch"
      });
    }

    return parsedResponse.data;
  }
}

interface JsonResponseBody {
  readonly body: unknown;
  readonly contentType: string | null;
  readonly bodyKind: "empty" | "json" | "html" | "text";
  readonly parseFailed: boolean;
}

async function readJsonResponse(response: Response): Promise<JsonResponseBody> {
  const contentType = response.headers.get("content-type");
  const text = await response.text();

  if (text.trim().length === 0) {
    return {
      body: null,
      contentType,
      bodyKind: "empty",
      parseFailed: false
    };
  }

  try {
    return {
      body: JSON.parse(text) as unknown,
      contentType,
      bodyKind: "json",
      parseFailed: false
    };
  } catch {
    return {
      body: null,
      contentType,
      bodyKind: text.trimStart().startsWith("<") ? "html" : "text",
      parseFailed: true
    };
  }
}

function requestHeaders(init: RequestInit, requestId: string): Headers {
  const headers = new Headers();

  headers.set("accept", "application/json");

  if (init.body !== undefined) {
    headers.set("content-type", "application/json");
  }

  new Headers(init.headers).forEach((value, key) => headers.set(key, value));

  if (!headers.has("x-request-id")) {
    headers.set("x-request-id", requestId);
  }

  return headers;
}

function createRequestId(): string {
  const randomId = globalThis.crypto?.randomUUID?.();

  if (randomId !== undefined && randomId.length > 0) {
    return randomId;
  }

  return `admin-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function formatJobListQuery(input: AdminJobListOptions): string {
  const params = new URLSearchParams();

  appendQuery(params, "sourceId", input.sourceId);
  appendQuery(params, "status", input.status);
  appendQuery(params, "jobType", input.jobType);
  appendQuery(params, "reason", input.reason);
  appendQuery(params, "urlContains", input.urlContains);
  appendQuery(params, "window", input.window);
  appendQuery(params, "limit", input.limit);
  appendQuery(params, "cursor", input.cursor);

  const query = params.toString();
  return query.length === 0 ? "" : `?${query}`;
}

function formatPageListQuery(input: AdminPageListOptions): string {
  const params = new URLSearchParams();

  appendQuery(params, "q", input.q);
  appendQuery(params, "freshness", input.freshness);
  appendQuery(params, "hasEmbedding", input.hasEmbedding);
  appendQuery(params, "limit", input.limit);
  appendQuery(params, "cursor", input.cursor);

  const query = params.toString();
  return query.length === 0 ? "" : `?${query}`;
}

function appendQuery(params: URLSearchParams, key: string, value: boolean | string | number | undefined): void {
  if (value !== undefined) {
    params.set(key, String(value));
  }
}

export const adminApiClient = new AdminApiClient();
