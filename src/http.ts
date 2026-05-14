import { parseRemoteDocsConfig, type RemoteDocsConfigIssue } from "./config/remote-docs-config";
import { createRemoteHttpApp } from "./http/app";
import { createRemoteDocsMcpHandler } from "./http/mcp";
import { createServerDependencies, type ServerDependencies } from "./server";

export interface ServeOptions {
  readonly hostname: string;
  readonly port: number;
  readonly fetch: (request: Request) => Response | Promise<Response>;
}

export type ServeFunction = (options: ServeOptions) => unknown;

export interface StartRemoteHttpServerOptions {
  readonly bearerToken?: string;
  readonly host?: string;
  readonly port?: number;
  readonly allowedOrigins?: readonly string[];
  readonly maxRequestBodyBytes?: number;
  readonly dependencies?: ServerDependencies;
  readonly env?: Record<string, string | undefined>;
  readonly serve?: ServeFunction;
}

export interface RemoteHttpStartupSuccess {
  readonly ok: true;
  readonly server: unknown;
  readonly host: string;
  readonly port: number;
}

export interface RemoteHttpStartupFailure {
  readonly ok: false;
  readonly error: {
    readonly code: "startup_failed";
    readonly message: string;
    readonly issues?: readonly RemoteDocsConfigIssue[];
  };
}

export type RemoteHttpStartupResult = RemoteHttpStartupSuccess | RemoteHttpStartupFailure;

function envWithOptionOverrides(
  env: Record<string, string | undefined>,
  options: StartRemoteHttpServerOptions
): Record<string, string | undefined> {
  return {
    ...env,
    ...(options.host === undefined ? {} : { MCP_HTTP_HOST: options.host }),
    ...(options.port === undefined ? {} : { MCP_HTTP_PORT: String(options.port) }),
    ...(options.bearerToken === undefined ? {} : { MCP_BEARER_TOKEN: options.bearerToken }),
    ...(options.allowedOrigins === undefined ? {} : { DOCS_ALLOWED_ORIGINS: options.allowedOrigins.join(",") }),
    ...(options.maxRequestBodyBytes === undefined ? {} : { MCP_HTTP_MAX_REQUEST_BODY_BYTES: String(options.maxRequestBodyBytes) })
  };
}

export function startRemoteHttpServer(options: StartRemoteHttpServerOptions = {}): RemoteHttpStartupResult {
  const env = envWithOptionOverrides(options.env ?? Bun.env, options);
  const configResult = parseRemoteDocsConfig(env);

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

  try {
    const config = configResult.config;
    const dependencies = options.dependencies ?? createServerDependencies();
    const app = createRemoteHttpApp({
      bearerToken: config.http.bearerToken,
      allowedOrigins: config.http.allowedOrigins,
      maxRequestBodyBytes: config.http.maxRequestBodyBytes,
      mcpHandler: createRemoteDocsMcpHandler({ dependencies })
    });
    const serve = options.serve ?? Bun.serve;
    const server = serve({
      hostname: config.http.host,
      port: config.http.port,
      fetch: app.fetch
    });

    return {
      ok: true,
      server,
      host: config.http.host,
      port: config.http.port
    };
  } catch {
    return {
      ok: false,
      error: {
        code: "startup_failed",
        message: "Remote HTTP server failed to start."
      }
    };
  }
}

if (import.meta.main) {
  const result = startRemoteHttpServer();

  if (!result.ok) {
    process.stderr.write(`bun-dev-intel-mcp http startup failed: ${result.error.message}\n`);
    process.exit(1);
  }

  process.stderr.write(`bun-dev-intel-mcp http listening on ${result.host}:${result.port}\n`);
}
