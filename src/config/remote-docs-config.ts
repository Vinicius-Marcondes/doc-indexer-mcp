export type EmbeddingProvider = "openai";

export interface RefreshInterval {
  readonly raw: string;
  readonly seconds: number;
}

export interface RemoteDocsConfig {
  readonly mode: "production" | "test";
  readonly http: {
    readonly host: string;
    readonly port: number;
    readonly bearerToken: string;
    readonly allowedOrigins: readonly string[];
    readonly maxRequestBodyBytes: number;
  };
  readonly database: {
    readonly url: string;
  };
  readonly embeddings: {
    readonly provider: EmbeddingProvider;
    readonly apiKey: string;
    readonly model: string;
  };
  readonly search: {
    readonly defaultLimit: number;
    readonly maxLimit: number;
  };
  readonly refresh: {
    readonly interval: RefreshInterval;
    readonly maxPagesPerRun: number;
    readonly maxEmbeddingsPerRun: number;
    readonly maxConcurrency: number;
  };
}

export interface RemoteDocsConfigIssue {
  readonly path: string;
  readonly message: string;
}

export interface RemoteDocsConfigError {
  readonly code: "invalid_remote_docs_config";
  readonly message: string;
  readonly issues: readonly RemoteDocsConfigIssue[];
}

export type ParseRemoteDocsConfigResult =
  | {
      readonly ok: true;
      readonly config: RemoteDocsConfig;
    }
  | {
      readonly ok: false;
      readonly error: RemoteDocsConfigError;
    };

const weakBearerTokens = new Set(["changeme", "change-me", "replace-me", "secret", "token", "password", "test", "test-token"]);

function requiredString(env: Record<string, string | undefined>, key: string, issues: RemoteDocsConfigIssue[]): string {
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
  issues: RemoteDocsConfigIssue[],
  options: { min?: number; max?: number } = {}
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

function parseDatabaseUrl(raw: string, issues: RemoteDocsConfigIssue[]): void {
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

function parseAllowedOrigins(raw: string | undefined, issues: RemoteDocsConfigIssue[]): string[] {
  if (raw === undefined || raw.trim().length === 0) {
    return [];
  }

  const origins: string[] = [];

  for (const origin of raw.split(",").map((value) => value.trim())) {
    if (origin.length === 0) {
      continue;
    }

    try {
      const parsed = new URL(origin);
      if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || parsed.pathname !== "/" || parsed.search !== "") {
        issues.push({ path: "DOCS_ALLOWED_ORIGINS", message: "DOCS_ALLOWED_ORIGINS must contain origin URLs only." });
      } else {
        origins.push(parsed.origin);
      }
    } catch {
      issues.push({ path: "DOCS_ALLOWED_ORIGINS", message: "DOCS_ALLOWED_ORIGINS must contain valid comma-separated origins." });
    }
  }

  return origins;
}

function parseRefreshInterval(raw: string | undefined, issues: RemoteDocsConfigIssue[]): RefreshInterval {
  const value = raw?.trim() || "7d";
  const match = /^(?<amount>[1-9][0-9]*)(?<unit>[smhd])$/u.exec(value);

  if (match?.groups === undefined) {
    issues.push({ path: "DOCS_REFRESH_INTERVAL", message: "DOCS_REFRESH_INTERVAL must use a format like 30m, 12h, or 7d." });
    return { raw: "7d", seconds: 604800 };
  }

  const amount = Number(match.groups.amount);
  const unit = match.groups.unit;
  const multiplier = unit === "s" ? 1 : unit === "m" ? 60 : unit === "h" ? 3600 : 86400;

  return {
    raw: value,
    seconds: amount * multiplier
  };
}

function isTestMode(env: Record<string, string | undefined>): boolean {
  return env.REMOTE_DOCS_CONFIG_MODE === "test";
}

function validateBearerToken(token: string, testMode: boolean, issues: RemoteDocsConfigIssue[]): void {
  if (token.length === 0) {
    return;
  }

  if (!testMode && (token.length < 16 || weakBearerTokens.has(token.toLowerCase()))) {
    issues.push({
      path: "MCP_BEARER_TOKEN",
      message: "MCP_BEARER_TOKEN must be a non-placeholder secret outside explicit test mode."
    });
  }
}

export function parseRemoteDocsConfig(env: Record<string, string | undefined>): ParseRemoteDocsConfigResult {
  const issues: RemoteDocsConfigIssue[] = [];
  const mode = isTestMode(env) ? "test" : "production";
  const host = requiredString(env, "MCP_HTTP_HOST", issues);
  const port = parseInteger(env, "MCP_HTTP_PORT", 3000, issues, { min: 1, max: 65535 });
  const bearerToken = requiredString(env, "MCP_BEARER_TOKEN", issues);
  const databaseUrl = requiredString(env, "DATABASE_URL", issues);
  const embeddingProvider = requiredString(env, "EMBEDDING_PROVIDER", issues);
  const openAiApiKey = requiredString(env, "OPENAI_API_KEY", issues);
  const openAiModel = requiredString(env, "OPENAI_EMBEDDING_MODEL", issues);
  const allowedOrigins = parseAllowedOrigins(env.DOCS_ALLOWED_ORIGINS, issues);
  const maxRequestBodyBytes = parseInteger(env, "MCP_HTTP_MAX_REQUEST_BODY_BYTES", 1024 * 1024, issues, {
    min: 1,
    max: 50 * 1024 * 1024
  });
  const defaultLimit = parseInteger(env, "DOCS_SEARCH_DEFAULT_LIMIT", 5, issues, { min: 1, max: 100 });
  const maxLimit = parseInteger(env, "DOCS_SEARCH_MAX_LIMIT", 20, issues, { min: 1, max: 100 });
  const refreshInterval = parseRefreshInterval(env.DOCS_REFRESH_INTERVAL, issues);
  const maxPagesPerRun = parseInteger(env, "DOCS_REFRESH_MAX_PAGES_PER_RUN", 500, issues, { min: 1, max: 100000 });
  const maxEmbeddingsPerRun = parseInteger(env, "DOCS_REFRESH_MAX_EMBEDDINGS_PER_RUN", 2000, issues, { min: 1, max: 100000 });
  const maxConcurrency = parseInteger(env, "DOCS_REFRESH_MAX_CONCURRENCY", 4, issues, { min: 1, max: 64 });

  validateBearerToken(bearerToken, mode === "test", issues);
  parseDatabaseUrl(databaseUrl, issues);

  if (embeddingProvider.length > 0 && embeddingProvider !== "openai") {
    issues.push({ path: "EMBEDDING_PROVIDER", message: 'EMBEDDING_PROVIDER must be "openai" for V1.' });
  }

  if (defaultLimit > maxLimit) {
    issues.push({ path: "DOCS_SEARCH_DEFAULT_LIMIT", message: "DOCS_SEARCH_DEFAULT_LIMIT must be less than or equal to DOCS_SEARCH_MAX_LIMIT." });
  }

  if (issues.length > 0) {
    return {
      ok: false,
      error: {
        code: "invalid_remote_docs_config",
        message: "Remote docs configuration is invalid.",
        issues
      }
    };
  }

  return {
    ok: true,
    config: {
      mode,
      http: {
        host,
        port,
        bearerToken,
        allowedOrigins,
        maxRequestBodyBytes
      },
      database: {
        url: databaseUrl
      },
      embeddings: {
        provider: "openai",
        apiKey: openAiApiKey,
        model: openAiModel
      },
      search: {
        defaultLimit,
        maxLimit
      },
      refresh: {
        interval: refreshInterval,
        maxPagesPerRun,
        maxEmbeddingsPerRun,
        maxConcurrency
      }
    }
  };
}
