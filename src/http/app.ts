import { Hono, type Context, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";

export interface ReadinessSuccess {
  readonly ok: true;
  readonly details?: Record<string, unknown>;
}

export interface ReadinessFailure {
  readonly ok: false;
  readonly message?: string;
  readonly details?: Record<string, unknown>;
}

export type ReadinessResult = ReadinessSuccess | ReadinessFailure;
export type ReadinessCheck = () => ReadinessResult | Promise<ReadinessResult>;
export type McpPlaceholderHandler = (context: Context) => Response | Promise<Response>;

export interface RemoteHttpAppOptions {
  readonly bearerToken: string;
  readonly allowedOrigins?: readonly string[];
  readonly maxRequestBodyBytes?: number;
  readonly readinessCheck?: ReadinessCheck;
  readonly mcpPlaceholderHandler?: McpPlaceholderHandler;
}

type ErrorStatus = 400 | 401 | 403 | 413 | 501 | 503;

const defaultMaxRequestBodyBytes = 1024 * 1024;
const queryTokenKeys = new Set(["access_token", "token", "auth", "authorization"]);

function jsonError(context: Context, status: ErrorStatus, code: string, message: string): Response {
  return context.json(
    {
      ok: false,
      error: {
        code,
        message,
        status
      }
    },
    status
  );
}

function rejectQueryTokens(): MiddlewareHandler {
  return async (context, next) => {
    const url = new URL(context.req.url);

    for (const key of queryTokenKeys) {
      if (url.searchParams.has(key)) {
        return jsonError(context, 400, "token_in_query_rejected", "Bearer tokens must be sent in the Authorization header.");
      }
    }

    await next();
  };
}

function validateOrigin(allowedOrigins: readonly string[] | undefined): MiddlewareHandler {
  const allowed = new Set(allowedOrigins ?? []);

  return async (context, next) => {
    const origin = context.req.header("origin");

    if (origin !== undefined && allowed.size > 0 && !allowed.has(origin)) {
      return jsonError(context, 403, "origin_forbidden", "Request origin is not allowed.");
    }

    await next();
  };
}

function requireBearerToken(expectedToken: string): MiddlewareHandler {
  return async (context, next) => {
    const authorization = context.req.header("authorization");

    if (authorization !== `Bearer ${expectedToken}`) {
      return jsonError(context, 401, "unauthorized", "Unauthorized.");
    }

    await next();
  };
}

async function defaultMcpPlaceholder(context: Context): Promise<Response> {
  return jsonError(context, 501, "mcp_transport_not_implemented", "MCP Streamable HTTP transport is not wired yet.");
}

export function createRemoteHttpApp(options: RemoteHttpAppOptions): Hono {
  if (options.bearerToken.trim().length === 0) {
    throw new Error("Remote HTTP bearer token must not be empty.");
  }

  const app = new Hono();
  const readinessCheck: ReadinessCheck = options.readinessCheck ?? (() => ({ ok: true }));
  const mcpPlaceholderHandler = options.mcpPlaceholderHandler ?? defaultMcpPlaceholder;

  app.get("/healthz", (context) =>
    context.json({
      ok: true,
      status: "ok",
      service: "bun-dev-intel-mcp-http"
    })
  );

  app.get("/readyz", async (context) => {
    try {
      const readiness = await readinessCheck();

      if (!readiness.ok) {
        return jsonError(context, 503, "not_ready", readiness.message ?? "Service is not ready.");
      }

      return context.json({
        ok: true,
        status: "ready",
        ...(readiness.details === undefined ? {} : { details: readiness.details })
      });
    } catch {
      return jsonError(context, 503, "not_ready", "Readiness check failed.");
    }
  });

  app.use("/mcp", rejectQueryTokens());
  app.use("/mcp", validateOrigin(options.allowedOrigins));
  app.use("/mcp", requireBearerToken(options.bearerToken));
  app.use(
    "/mcp",
    bodyLimit({
      maxSize: options.maxRequestBodyBytes ?? defaultMaxRequestBodyBytes,
      onError: (context) => jsonError(context, 413, "request_body_too_large", "Request body is too large.")
    })
  );

  app.on(["GET", "POST", "DELETE"], "/mcp", (context) => mcpPlaceholderHandler(context));

  return app;
}
