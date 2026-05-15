import type { Hono } from "hono";
import {
  adminErrorResponseSchema,
  adminSearchResponseSchema,
  type AdminErrorResponse,
  type AdminSearchRequest,
  type AdminSearchResponse
} from "@bun-dev-intel/admin-contracts";
import { createOpenAiEmbeddingProviderFromConfig } from "../../../../src/docs/embeddings/openai-provider";
import { RefreshJobQueue } from "../../../../src/docs/refresh/refresh-queue";
import { HybridDocsRetrieval } from "../../../../src/docs/retrieval/hybrid-retrieval";
import { PostgresKeywordRetrieval } from "../../../../src/docs/retrieval/keyword-retrieval";
import { PostgresVectorRetrieval } from "../../../../src/docs/retrieval/vector-retrieval";
import { defaultDocsSourceRegistry } from "../../../../src/docs/sources/bun-source-pack";
import type { DocsSourceRegistry } from "../../../../src/docs/sources/registry";
import {
  createDatabaseReadinessCheck,
  createPostgresClient,
  type SqlClient
} from "../../../../src/docs/storage/database";
import { RemoteDocsStorage } from "../../../../src/docs/storage/docs-storage";
import { searchDocs, type SearchDocsRefreshQueue, type SearchDocsRetrieval } from "../../../../src/tools/search-docs";
import { AdminActionsService, PostgresAdminActionStore } from "./actions";
import { createAdminConsoleApp } from "./app";
import { AdminAuthStorage, bootstrapFirstAdminUser, InMemoryLoginRateLimiter } from "./auth";
import { AdminReadModelStorage } from "./read-models";
import type { AdminSearchService } from "./api";

export interface AdminRuntimeConfigIssue {
  readonly path: string;
  readonly message: string;
}

export interface AdminRuntimeConfig {
  readonly http: {
    readonly host: string;
    readonly port: number;
  };
  readonly database: {
    readonly url: string;
  };
  readonly embeddings: {
    readonly provider: "openai";
    readonly apiKey: string;
    readonly model: string;
    readonly baseUrl?: string;
    readonly dimensions?: number;
  };
  readonly search: {
    readonly defaultLimit: number;
    readonly maxLimit: number;
  };
  readonly refresh: {
    readonly maxPagesPerRun: number;
    readonly maxEmbeddingsPerRun: number;
  };
  readonly auth: {
    readonly sessionTtlSeconds: number;
    readonly secureCookies: boolean;
    readonly loginRateLimitWindowSeconds: number;
    readonly loginRateLimitMaxAttempts: number;
  };
  readonly staticAssetsRoot: string;
}

export type ParseAdminRuntimeConfigResult =
  | {
      readonly ok: true;
      readonly config: AdminRuntimeConfig;
    }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: "invalid_admin_runtime_config";
        readonly message: string;
        readonly issues: readonly AdminRuntimeConfigIssue[];
      };
    };

export interface CreateAdminRuntimeAppOptions {
  readonly env?: Record<string, string | undefined>;
  readonly sql?: SqlClient;
  readonly now?: () => string;
  readonly staticAssetsRoot?: string;
  readonly sourceRegistry?: DocsSourceRegistry;
  readonly bootstrap?: boolean;
  readonly seedSources?: boolean;
}

export type CreateAdminRuntimeAppResult =
  | {
      readonly ok: true;
      readonly app: Hono;
      readonly config: AdminRuntimeConfig;
      readonly sql: SqlClient;
      readonly close: () => Promise<void>;
    }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: "startup_failed";
        readonly message: string;
        readonly issues?: readonly AdminRuntimeConfigIssue[];
      };
    };

export interface ServeOptions {
  readonly hostname: string;
  readonly port: number;
  readonly fetch: (request: Request) => Response | Promise<Response>;
}

export type ServeFunction = (options: ServeOptions) => unknown;

export interface StartAdminConsoleServerOptions extends CreateAdminRuntimeAppOptions {
  readonly serve?: ServeFunction;
}

export type StartAdminConsoleServerResult =
  | {
      readonly ok: true;
      readonly server: unknown;
      readonly host: string;
      readonly port: number;
    }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: "startup_failed";
        readonly message: string;
        readonly issues?: readonly AdminRuntimeConfigIssue[];
      };
    };

function requiredString(env: Record<string, string | undefined>, key: string, issues: AdminRuntimeConfigIssue[]): string {
  const value = env[key]?.trim();

  if (value === undefined || value.length === 0) {
    issues.push({ path: key, message: `${key} is required.` });
    return "";
  }

  return value;
}

function parseInteger(
  env: Record<string, string | undefined>,
  key: string,
  defaultValue: number,
  issues: AdminRuntimeConfigIssue[],
  options: { readonly min?: number; readonly max?: number } = {}
): number {
  const raw = env[key]?.trim();

  if (raw === undefined || raw.length === 0) {
    return defaultValue;
  }

  const parsed = Number(raw);
  const min = options.min ?? 1;
  const max = options.max ?? Number.MAX_SAFE_INTEGER;

  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    issues.push({ path: key, message: `${key} must be an integer between ${min} and ${max}.` });
    return defaultValue;
  }

  return parsed;
}

function parseOptionalInteger(
  env: Record<string, string | undefined>,
  key: string,
  issues: AdminRuntimeConfigIssue[],
  options: { readonly min?: number; readonly max?: number } = {}
): number | undefined {
  const raw = env[key]?.trim();

  if (raw === undefined || raw.length === 0) {
    return undefined;
  }

  const parsed = Number(raw);
  const min = options.min ?? 1;
  const max = options.max ?? Number.MAX_SAFE_INTEGER;

  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    issues.push({ path: key, message: `${key} must be an integer between ${min} and ${max}.` });
    return undefined;
  }

  return parsed;
}

function parseBoolean(
  env: Record<string, string | undefined>,
  key: string,
  defaultValue: boolean,
  issues: AdminRuntimeConfigIssue[]
): boolean {
  const raw = env[key]?.trim().toLowerCase();

  if (raw === undefined || raw.length === 0) {
    return defaultValue;
  }

  if (raw === "true" || raw === "1") {
    return true;
  }

  if (raw === "false" || raw === "0") {
    return false;
  }

  issues.push({ path: key, message: `${key} must be true or false.` });
  return defaultValue;
}

function parseDatabaseUrl(raw: string, issues: AdminRuntimeConfigIssue[]): void {
  if (raw.length === 0) {
    return;
  }

  try {
    const url = new URL(raw);

    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
      issues.push({ path: "DATABASE_URL", message: "DATABASE_URL must use postgres:// or postgresql://." });
    }
  } catch {
    issues.push({ path: "DATABASE_URL", message: "DATABASE_URL must be a valid Postgres URL." });
  }
}

function parseOptionalHttpUrl(
  env: Record<string, string | undefined>,
  key: string,
  issues: AdminRuntimeConfigIssue[]
): string | undefined {
  const raw = env[key]?.trim();

  if (raw === undefined || raw.length === 0) {
    return undefined;
  }

  try {
    const url = new URL(raw);

    if (url.protocol !== "https:" && url.protocol !== "http:") {
      issues.push({ path: key, message: `${key} must use http:// or https://.` });
      return undefined;
    }

    return url.href.replace(/\/$/u, "");
  } catch {
    issues.push({ path: key, message: `${key} must be a valid URL.` });
    return undefined;
  }
}

export function parseAdminRuntimeConfig(env: Record<string, string | undefined>): ParseAdminRuntimeConfigResult {
  const issues: AdminRuntimeConfigIssue[] = [];
  const host = env.ADMIN_HTTP_HOST?.trim() || "0.0.0.0";
  const port = parseInteger(env, "ADMIN_HTTP_PORT", 3100, issues, { min: 1, max: 65535 });
  const databaseUrl = requiredString(env, "DATABASE_URL", issues);
  const embeddingProvider = requiredString(env, "EMBEDDING_PROVIDER", issues);
  const openAiApiKey = requiredString(env, "OPENAI_API_KEY", issues);
  const openAiModel = requiredString(env, "OPENAI_EMBEDDING_MODEL", issues);
  const openAiBaseUrl = parseOptionalHttpUrl(env, "OPENAI_BASE_URL", issues);
  const openAiDimensions = parseOptionalInteger(env, "OPENAI_EMBEDDING_DIMENSIONS", issues, {
    min: 1,
    max: 8192
  });
  const defaultLimit = parseInteger(env, "DOCS_SEARCH_DEFAULT_LIMIT", 5, issues, { min: 1, max: 100 });
  const maxLimit = parseInteger(env, "DOCS_SEARCH_MAX_LIMIT", 20, issues, { min: 1, max: 100 });
  const maxPagesPerRun = parseInteger(env, "DOCS_REFRESH_MAX_PAGES_PER_RUN", 500, issues, { min: 1, max: 100000 });
  const maxEmbeddingsPerRun = parseInteger(env, "DOCS_REFRESH_MAX_EMBEDDINGS_PER_RUN", 2000, issues, { min: 1, max: 100000 });
  const sessionTtlSeconds = parseInteger(env, "ADMIN_SESSION_TTL_SECONDS", 604800, issues, { min: 60, max: 60 * 60 * 24 * 90 });
  const loginRateLimitWindowSeconds = parseInteger(env, "ADMIN_LOGIN_RATE_LIMIT_WINDOW_SECONDS", 900, issues, { min: 10, max: 86400 });
  const loginRateLimitMaxAttempts = parseInteger(env, "ADMIN_LOGIN_RATE_LIMIT_MAX_ATTEMPTS", 10, issues, { min: 1, max: 1000 });
  const secureCookies = parseBoolean(env, "ADMIN_COOKIE_SECURE", env.NODE_ENV === "production", issues);

  if (embeddingProvider.length > 0 && embeddingProvider !== "openai") {
    issues.push({ path: "EMBEDDING_PROVIDER", message: 'EMBEDDING_PROVIDER must be "openai" for V1.' });
  }

  if (openAiDimensions !== undefined && openAiDimensions !== 1536) {
    issues.push({
      path: "OPENAI_EMBEDDING_DIMENSIONS",
      message: "OPENAI_EMBEDDING_DIMENSIONS must be 1536 for the current remote docs vector schema."
    });
  }

  if (defaultLimit > maxLimit) {
    issues.push({ path: "DOCS_SEARCH_DEFAULT_LIMIT", message: "DOCS_SEARCH_DEFAULT_LIMIT must be less than or equal to DOCS_SEARCH_MAX_LIMIT." });
  }

  parseDatabaseUrl(databaseUrl, issues);

  if (issues.length > 0) {
    return {
      ok: false,
      error: {
        code: "invalid_admin_runtime_config",
        message: "Admin console configuration is invalid.",
        issues
      }
    };
  }

  return {
    ok: true,
    config: {
      http: {
        host,
        port
      },
      database: {
        url: databaseUrl
      },
      embeddings: {
        provider: "openai",
        apiKey: openAiApiKey,
        model: openAiModel,
        ...(openAiBaseUrl === undefined ? {} : { baseUrl: openAiBaseUrl }),
        ...(openAiDimensions === undefined ? {} : { dimensions: openAiDimensions })
      },
      search: {
        defaultLimit,
        maxLimit
      },
      refresh: {
        maxPagesPerRun,
        maxEmbeddingsPerRun
      },
      auth: {
        sessionTtlSeconds,
        secureCookies,
        loginRateLimitWindowSeconds,
        loginRateLimitMaxAttempts
      },
      staticAssetsRoot: env.ADMIN_STATIC_ASSETS_DIR?.trim() || "apps/admin-console/client/dist"
    }
  };
}

function adminError(status: 400 | 500, code: string, message: string): AdminErrorResponse {
  return adminErrorResponseSchema.parse({
    ok: false,
    error: {
      code,
      message,
      status
    }
  });
}

function statusForSearchFailure(code: string): 400 | 500 {
  return code === "invalid_input" || code === "disallowed_source" ? 400 : 500;
}

export class SearchDocsAdminSearchService implements AdminSearchService {
  constructor(
    private readonly options: {
      readonly retrieval: SearchDocsRetrieval;
      readonly refreshQueue: SearchDocsRefreshQueue;
      readonly sourceRegistry: DocsSourceRegistry;
      readonly now: () => string;
      readonly defaultLimit: number;
      readonly maxLimit: number;
    }
  ) {}

  async search(input: AdminSearchRequest): Promise<AdminSearchResponse | AdminErrorResponse> {
    const result = await searchDocs(input, {
      retrieval: this.options.retrieval,
      refreshQueue: this.options.refreshQueue,
      sourceRegistry: this.options.sourceRegistry,
      now: this.options.now,
      defaultLimit: this.options.defaultLimit,
      maxLimit: this.options.maxLimit
    });

    if (!result.ok) {
      return adminError(statusForSearchFailure(result.error.code), result.error.code, result.error.message);
    }

    return adminSearchResponseSchema.parse(result);
  }
}

async function seedConfiguredDocsSources(store: RemoteDocsStorage, sourceRegistry: DocsSourceRegistry): Promise<void> {
  for (const source of sourceRegistry.list()) {
    await store.upsertSource({
      sourceId: source.sourceId,
      displayName: source.displayName,
      enabled: source.enabled,
      allowedUrlPatterns: source.allowedUrlPatterns,
      defaultTtlSeconds: source.refreshPolicy.defaultTtlSeconds
    });
  }
}

function queueLimitFromConfig(config: AdminRuntimeConfig["refresh"]): number {
  return Math.max(config.maxPagesPerRun + config.maxEmbeddingsPerRun, 100);
}

function createAdminRuntimeServices(input: {
  readonly config: AdminRuntimeConfig;
  readonly sql: SqlClient;
  readonly now: () => string;
  readonly sourceRegistry: DocsSourceRegistry;
}): {
  readonly authStorage: AdminAuthStorage;
  readonly docsStorage: RemoteDocsStorage;
  readonly readModels: AdminReadModelStorage;
  readonly actionStore: PostgresAdminActionStore;
  readonly refreshQueue: RefreshJobQueue;
  readonly searchService: SearchDocsAdminSearchService;
} {
  const authStorage = new AdminAuthStorage(input.sql);
  const docsStorage = new RemoteDocsStorage(input.sql);
  const readModels = new AdminReadModelStorage(input.sql);
  const actionStore = new PostgresAdminActionStore(input.sql);
  const embeddingProvider = createOpenAiEmbeddingProviderFromConfig(input.config.embeddings);
  const refreshQueue = new RefreshJobQueue({
    store: docsStorage,
    sourceRegistry: input.sourceRegistry,
    now: input.now,
    maxPendingJobs: queueLimitFromConfig(input.config.refresh),
    maxPendingJobsPerSource: Math.max(input.config.refresh.maxPagesPerRun, 100)
  });
  const retrieval = new HybridDocsRetrieval({
    keywordRetrieval: new PostgresKeywordRetrieval({
      sql: input.sql,
      defaultLimit: input.config.search.defaultLimit,
      maxLimit: input.config.search.maxLimit
    }),
    vectorRetrieval: new PostgresVectorRetrieval({
      sql: input.sql,
      embeddingProvider,
      defaultLimit: input.config.search.defaultLimit,
      maxLimit: input.config.search.maxLimit
    }),
    telemetry: docsStorage,
    defaultLimit: input.config.search.defaultLimit,
    maxLimit: input.config.search.maxLimit
  });
  const searchService = new SearchDocsAdminSearchService({
    retrieval,
    refreshQueue,
    sourceRegistry: input.sourceRegistry,
    now: input.now,
    defaultLimit: input.config.search.defaultLimit,
    maxLimit: input.config.search.maxLimit
  });

  return {
    authStorage,
    docsStorage,
    readModels,
    actionStore,
    refreshQueue,
    searchService
  };
}

export async function createAdminRuntimeApp(options: CreateAdminRuntimeAppOptions = {}): Promise<CreateAdminRuntimeAppResult> {
  const configResult = parseAdminRuntimeConfig(options.env ?? Bun.env);

  if (!configResult.ok) {
    return {
      ok: false,
      error: {
        code: "startup_failed",
        message: configResult.error.message,
        issues: configResult.error.issues
      }
    };
  }

  const config = {
    ...configResult.config,
    ...(options.staticAssetsRoot === undefined ? {} : { staticAssetsRoot: options.staticAssetsRoot })
  };
  const ownsSql = options.sql === undefined;
  const sql = options.sql ?? createPostgresClient(config.database.url);
  const now = options.now ?? (() => new Date().toISOString());
  const sourceRegistry = options.sourceRegistry ?? defaultDocsSourceRegistry;

  try {
    const services = createAdminRuntimeServices({ config, sql, now, sourceRegistry });

    if (options.seedSources !== false) {
      await seedConfiguredDocsSources(services.docsStorage, sourceRegistry);
    }

    if (options.bootstrap !== false) {
      await bootstrapFirstAdminUser({
        storage: services.authStorage,
        env: options.env ?? Bun.env,
        now
      });
    }

    const databaseReadinessCheck = createDatabaseReadinessCheck(sql);
    const app = createAdminConsoleApp({
      adminApi: {
        authStore: services.authStorage,
        readModels: services.readModels,
        searchService: services.searchService,
        actionService: new AdminActionsService({
          store: services.actionStore,
          queue: services.refreshQueue
        }),
        auditStore: services.actionStore,
        now,
        sessionTtlSeconds: config.auth.sessionTtlSeconds,
        secureCookies: config.auth.secureCookies,
        loginRateLimiter: new InMemoryLoginRateLimiter({
          maxAttempts: config.auth.loginRateLimitMaxAttempts,
          windowSeconds: config.auth.loginRateLimitWindowSeconds,
          now: () => Date.now()
        })
      },
      readinessCheck: async () => (await databaseReadinessCheck()).ok,
      staticAssetsRoot: config.staticAssetsRoot
    });

    return {
      ok: true,
      app,
      config,
      sql,
      close: async () => {
        if (ownsSql) {
          await sql.end?.({ timeout: 1 });
        }
      }
    };
  } catch {
    if (ownsSql) {
      await sql.end?.({ timeout: 1 });
    }

    return {
      ok: false,
      error: {
        code: "startup_failed",
        message: "Admin console failed to initialize."
      }
    };
  }
}

export async function startAdminConsoleServer(options: StartAdminConsoleServerOptions = {}): Promise<StartAdminConsoleServerResult> {
  const appResult = await createAdminRuntimeApp(options);

  if (!appResult.ok) {
    return appResult;
  }

  try {
    const serve = options.serve ?? Bun.serve;
    const server = serve({
      hostname: appResult.config.http.host,
      port: appResult.config.http.port,
      fetch: appResult.app.fetch
    });

    return {
      ok: true,
      server,
      host: appResult.config.http.host,
      port: appResult.config.http.port
    };
  } catch {
    await appResult.close();

    return {
      ok: false,
      error: {
        code: "startup_failed",
        message: "Admin console failed to start."
      }
    };
  }
}
