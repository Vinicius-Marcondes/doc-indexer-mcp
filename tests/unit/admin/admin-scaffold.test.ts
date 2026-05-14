import { readFileSync } from "node:fs";
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

    expect(packageJson.workspaces).toEqual([
      "apps/admin-console/client",
      "apps/admin-console/server",
      "packages/admin-contracts"
    ]);
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
