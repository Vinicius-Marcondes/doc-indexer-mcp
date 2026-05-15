import { createAdminConsoleApp } from "./app";

const app = createAdminConsoleApp({
  staticAssetsRoot: Bun.env.ADMIN_STATIC_ASSETS_DIR ?? "apps/admin-console/client/dist"
});
const port = Number(Bun.env.ADMIN_HTTP_PORT ?? 3100);
const hostname = Bun.env.ADMIN_HTTP_HOST ?? "0.0.0.0";

Bun.serve({
  hostname,
  port,
  fetch: app.fetch
});

process.stderr.write(`bun-dev-intel-admin-console listening on ${hostname}:${port}\n`);

export { createAdminConsoleApp };
