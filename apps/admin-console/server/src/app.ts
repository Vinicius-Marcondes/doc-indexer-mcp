import { Hono, type Context } from "hono";
import { adminHealthResponseSchema, adminServiceName } from "@bun-dev-intel/admin-contracts";

export interface AdminConsoleAppOptions {
  readonly readinessCheck?: () => boolean | Promise<boolean>;
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
