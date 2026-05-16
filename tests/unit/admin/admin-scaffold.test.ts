import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import { createAdminConsoleApp } from "../../../apps/admin-console/server/src/app";
import { adminHealthResponseSchema } from "../../../packages/admin-contracts/src/index";

const rootDir = resolve(import.meta.dir, "../../..");

describe("admin console scaffold", () => {
  test("root package declares admin workspaces", () => {
    const packageJson = JSON.parse(readFileSync(resolve(rootDir, "package.json"), "utf8")) as {
      readonly workspaces?: readonly string[];
    };

    expect(packageJson.workspaces).toEqual(["apps/*", "apps/admin-console/*", "packages/*"]);
  });

  test("admin server exports a Hono app factory", async () => {
    const app = createAdminConsoleApp();
    const response = await app.request("/healthz");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      status: "ok",
      service: "bun-dev-intel-admin-console"
    });
  });

  test("admin server serves built client assets with SPA fallback when configured", async () => {
    const staticRoot = mkdtempSync(resolve(tmpdir(), "admin-console-static-"));
    mkdirSync(resolve(staticRoot, "assets"));
    writeFileSync(resolve(staticRoot, "index.html"), "<!doctype html><div id=\"root\">Admin shell</div>");
    writeFileSync(resolve(staticRoot, "assets", "app.js"), "console.log('admin shell');");

    try {
      const app = createAdminConsoleApp({ staticAssetsRoot: staticRoot });
      const indexResponse = await app.request("/");
      const assetResponse = await app.request("/assets/app.js");
      const fallbackResponse = await app.request("/sources/bun");
      const apiMissResponse = await app.request("/api/admin/missing");

      expect(indexResponse.status).toBe(200);
      expect(indexResponse.headers.get("content-type")).toContain("text/html");
      expect(await indexResponse.text()).toContain("Admin shell");
      expect(assetResponse.status).toBe(200);
      expect(assetResponse.headers.get("content-type")).toContain("text/javascript");
      expect(await assetResponse.text()).toContain("admin shell");
      expect(fallbackResponse.status).toBe(200);
      expect(await fallbackResponse.text()).toContain("Admin shell");
      expect(apiMissResponse.status).toBe(404);
    } finally {
      rmSync(staticRoot, { recursive: true, force: true });
    }
  });

  test("shared contracts package exports a smoke schema", () => {
    expect(
      adminHealthResponseSchema.parse({
        ok: true,
        status: "ok",
        service: "bun-dev-intel-admin-console"
      })
    ).toEqual({
      ok: true,
      status: "ok",
      service: "bun-dev-intel-admin-console"
    });
  });
});
