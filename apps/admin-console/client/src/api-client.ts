import {
  adminAuthUserResponseSchema,
  adminErrorResponseSchema,
  adminKpisResponseSchema,
  adminLoginRequestSchema,
  adminLogoutResponseSchema,
  adminOverviewResponseSchema,
  adminSearchRequestSchema,
  adminSearchResponseSchema,
  type AdminErrorResponse,
  type AdminKpiWindow,
  type AdminLoginRequest,
  type AdminOverviewKpis,
  type AdminRetrievalKpis,
  type AdminSearchRequest,
  type AdminSearchResponse,
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

export const adminApiClient = new AdminApiClient();
