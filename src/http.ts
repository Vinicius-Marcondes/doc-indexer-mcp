import { createRemoteHttpApp, type RemoteHttpAppOptions } from "./http/app";
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
  };
}

export type RemoteHttpStartupResult = RemoteHttpStartupSuccess | RemoteHttpStartupFailure;

function parsePort(value: string | undefined): number {
  if (value === undefined || value.trim().length === 0) {
    return 3000;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 3000;
}

function optionsFromEnv(env: Record<string, string | undefined>): Pick<RemoteHttpAppOptions, "allowedOrigins" | "maxRequestBodyBytes"> {
  const allowedOrigins = env.DOCS_ALLOWED_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  const maxRequestBodyBytes = env.MCP_HTTP_MAX_REQUEST_BODY_BYTES;

  return {
    ...(allowedOrigins === undefined || allowedOrigins.length === 0 ? {} : { allowedOrigins }),
    ...(maxRequestBodyBytes === undefined ? {} : { maxRequestBodyBytes: Number(maxRequestBodyBytes) })
  };
}

export function startRemoteHttpServer(options: StartRemoteHttpServerOptions = {}): RemoteHttpStartupResult {
  const env = options.env ?? Bun.env;
  const bearerToken = options.bearerToken ?? env.MCP_BEARER_TOKEN;

  if (bearerToken === undefined || bearerToken.trim().length === 0) {
    return {
      ok: false,
      error: {
        code: "startup_failed",
        message: "MCP_BEARER_TOKEN is required for the remote HTTP server."
      }
    };
  }

  try {
    const host = options.host ?? env.MCP_HTTP_HOST ?? "0.0.0.0";
    const port = options.port ?? parsePort(env.MCP_HTTP_PORT);
    const dependencies = options.dependencies ?? createServerDependencies();
    const app = createRemoteHttpApp({
      ...optionsFromEnv(env),
      bearerToken,
      ...(options.allowedOrigins === undefined ? {} : { allowedOrigins: options.allowedOrigins }),
      ...(options.maxRequestBodyBytes === undefined ? {} : { maxRequestBodyBytes: options.maxRequestBodyBytes }),
      mcpHandler: createRemoteDocsMcpHandler({ dependencies })
    });
    const serve = options.serve ?? Bun.serve;
    const server = serve({
      hostname: host,
      port,
      fetch: app.fetch
    });

    return {
      ok: true,
      server,
      host,
      port
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
