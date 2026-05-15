import {
  adminAuthUserResponseSchema,
  adminErrorResponseSchema,
  adminKpisResponseSchema,
  adminJobsResponseSchema,
  adminLoginRequestSchema,
  adminLogoutResponseSchema,
  adminOverviewResponseSchema,
  adminSearchRequestSchema,
  adminSearchResponseSchema,
  adminSourcesResponseSchema,
  type AdminErrorResponse,
  type AdminJobSummary,
  type AdminKpiWindow,
  type AdminLoginRequest,
  type AdminOverviewKpis,
  type AdminRetrievalKpis,
  type AdminSearchRequest,
  type AdminSearchResponse,
  type AdminSourceHealth,
  type AdminUser
} from "@bun-dev-intel/admin-contracts";

interface ResponseParser<T> {
  readonly parse: (value: unknown) => T;
}

export class AdminApiClientError extends Error {
  constructor(readonly response: AdminErrorResponse) {
    super(response.error.message);
    this.name = "AdminApiClientError";
  }
}

export interface AdminApiClientOptions {
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
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

export class AdminApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: AdminApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? "";
    this.fetchImpl = options.fetchImpl ?? fetch;
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

  async listJobs(input: AdminJobListOptions = {}): Promise<AdminJobListResult> {
    const response = await this.fetchJson(`/api/admin/jobs${formatJobListQuery(input)}`, adminJobsResponseSchema, {
      method: "GET"
    });

    return {
      jobs: response.jobs,
      nextCursor: response.nextCursor
    };
  }

  async search(input: AdminSearchRequest): Promise<AdminSearchResponse> {
    const request = adminSearchRequestSchema.parse(input);
    return this.fetchJson("/api/admin/search", adminSearchResponseSchema, {
      method: "POST",
      body: JSON.stringify(request)
    });
  }

  private async fetchJson<T>(path: string, parser: ResponseParser<T>, init: RequestInit): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      credentials: "include",
      headers: {
        accept: "application/json",
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
        ...init.headers
      }
    });
    const body = await readJson(response);

    if (!response.ok) {
      const parsedError = adminErrorResponseSchema.safeParse(body);

      if (parsedError.success) {
        if (parsedError.data.error.code === "unauthorized" && path === "/api/admin/auth/me") {
          return { ok: true, user: null } as T;
        }

        throw new AdminApiClientError(parsedError.data);
      }

      throw new AdminApiClientError({
        ok: false,
        error: {
          code: "request_failed",
          message: "Admin API request failed.",
          status: response.status
        }
      });
    }

    return parser.parse(body);
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
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

function appendQuery(params: URLSearchParams, key: string, value: string | number | undefined): void {
  if (value !== undefined) {
    params.set(key, String(value));
  }
}

export const adminApiClient = new AdminApiClient();
