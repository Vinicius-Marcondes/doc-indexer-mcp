import { extname, relative, resolve } from "node:path";
import { Hono, type Context } from "hono";
import { adminHealthResponseSchema, adminServiceName } from "@bun-dev-intel/admin-contracts";
import { createAdminApiRoutes, type AdminApiOptions } from "./api";

export interface AdminConsoleAppOptions {
  readonly readinessCheck?: () => boolean | Promise<boolean>;
  readonly adminApi?: AdminApiOptions;
  readonly staticAssetsRoot?: string;
}

function jsonError(context: Context, status: 503, code: string, message: string): Response {
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

function staticContentType(path: string): string {
  switch (extname(path)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".ico":
      return "image/x-icon";
    default:
      return "application/octet-stream";
  }
}

function resolveStaticAsset(root: string, requestPath: string): string | null {
  let decodedPath: string;

  try {
    decodedPath = decodeURIComponent(requestPath);
  } catch {
    return null;
  }

  const relativePath = decodedPath === "/" ? "index.html" : decodedPath.replace(/^\/+/, "");
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(resolvedRoot, relativePath);
  const childPath = relative(resolvedRoot, resolvedPath);

  if (childPath.startsWith("..") || childPath === "") {
    return null;
  }

  return resolvedPath;
}

async function serveStaticAsset(context: Context, root: string): Promise<Response> {
  const requestPath = new URL(context.req.url).pathname;

  if (requestPath.startsWith("/api/")) {
    return context.text("Not found", 404);
  }

  const resolvedPath = resolveStaticAsset(root, requestPath);

  if (resolvedPath !== null) {
    const asset = Bun.file(resolvedPath);

    if (await asset.exists()) {
      return new Response(asset, {
        headers: {
          "content-type": staticContentType(resolvedPath)
        }
      });
    }
  }

  const fallback = Bun.file(resolve(root, "index.html"));

  if (await fallback.exists()) {
    return new Response(fallback, {
      headers: {
        "content-type": "text/html; charset=utf-8"
      }
    });
  }

  return context.text("Not found", 404);
}

export function createAdminConsoleApp(options: AdminConsoleAppOptions = {}): Hono {
  const app = new Hono();
  const readinessCheck = options.readinessCheck ?? (() => true);

  if (options.adminApi !== undefined) {
    app.route("/api/admin", createAdminApiRoutes(options.adminApi));
  }

  app.get("/healthz", (context) =>
    context.json(
      adminHealthResponseSchema.parse({
        ok: true,
        status: "ok",
        service: adminServiceName
      })
    )
  );

  app.get("/readyz", async (context) => {
    const ready = await readinessCheck();

    if (!ready) {
      return jsonError(context, 503, "not_ready", "Admin console is not ready.");
    }

    return context.json(
      adminHealthResponseSchema.parse({
        ok: true,
        status: "ready",
        service: adminServiceName
      })
    );
  });

  if (options.staticAssetsRoot !== undefined) {
    app.get("*", (context) => serveStaticAsset(context, options.staticAssetsRoot as string));
  }

  return app;
}
