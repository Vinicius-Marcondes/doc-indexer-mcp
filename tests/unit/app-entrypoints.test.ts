import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const rootDir = resolve(import.meta.dir, "../..");

function read(path: string): string {
  return readFileSync(resolve(rootDir, path), "utf8");
}

describe("runtime app entrypoints", () => {
  test("MCP HTTP app package owns the startable HTTP entrypoint", () => {
    expect(existsSync(resolve(rootDir, "apps/mcp-http/package.json"))).toBe(true);
    expect(existsSync(resolve(rootDir, "apps/mcp-http/src/index.ts"))).toBe(true);

    const packageJson = JSON.parse(read("apps/mcp-http/package.json")) as {
      readonly name?: string;
      readonly scripts?: Record<string, string>;
    };
    const entrypoint = read("apps/mcp-http/src/index.ts");

    expect(packageJson.name).toBe("@bun-dev-intel/mcp-http");
    expect(packageJson.scripts?.typecheck).toBe("tsc -p tsconfig.json --noEmit");
    expect(entrypoint).toContain("startRemoteHttpServer");
    expect(entrypoint).toContain("../../../src/http/app");
    expect(entrypoint).not.toContain("apps/admin-console");
  });

  test("docs worker app package owns the startable worker entrypoint", () => {
    expect(existsSync(resolve(rootDir, "apps/docs-worker/package.json"))).toBe(true);
    expect(existsSync(resolve(rootDir, "apps/docs-worker/src/index.ts"))).toBe(true);

    const packageJson = JSON.parse(read("apps/docs-worker/package.json")) as {
      readonly name?: string;
      readonly scripts?: Record<string, string>;
    };
    const entrypoint = read("apps/docs-worker/src/index.ts");

    expect(packageJson.name).toBe("@bun-dev-intel/docs-worker");
    expect(packageJson.scripts?.typecheck).toBe("tsc -p tsconfig.json --noEmit");
    expect(entrypoint).toContain("runDocsWorkerOnce");
    expect(entrypoint).toContain("@bun-dev-intel/db");
    expect(entrypoint).toContain("@bun-dev-intel/docs-domain");
    expect(entrypoint).not.toContain("createRemoteDocsMcpHandler");
    expect(entrypoint).not.toContain("apps/admin-console");
  });

  test("legacy root runtime files are thin compatibility wrappers", () => {
    const http = read("src/http.ts");
    const worker = read("src/docs-worker.ts");

    expect(http).toContain("../apps/mcp-http/src/index");
    expect(worker).toContain("../apps/docs-worker/src/index");
    expect(http.length).toBeLessThan(900);
    expect(worker.length).toBeLessThan(900);
  });
});
