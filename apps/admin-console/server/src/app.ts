import { Hono, type Context } from "hono";
import { adminHealthResponseSchema, adminServiceName } from "@bun-dev-intel/admin-contracts";
import { createAdminApiRoutes, type AdminApiOptions } from "./api";

export interface AdminConsoleAppOptions {
  readonly readinessCheck?: () => boolean | Promise<boolean>;
  readonly adminApi?: AdminApiOptions;
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

  return app;
}
