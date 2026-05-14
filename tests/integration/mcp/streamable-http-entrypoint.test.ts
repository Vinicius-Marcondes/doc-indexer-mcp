import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createRemoteHttpApp } from "../../../src/http/app";
import { createRemoteDocsMcpHandler } from "../../../src/http/mcp";
import { createServerDependencies, getRemoteDocsCapabilityManifest } from "../../../src/server";

const bearerToken = "streamable-test-token";
const tempDirs: string[] = [];

function tempCachePath(): string {
  const dir = mkdtempSync(resolve(tmpdir(), "bun-dev-intel-streamable-http-"));
  tempDirs.push(dir);
  return resolve(dir, "cache.sqlite");
}

function mcpJsonHeaders(): Record<string, string> {
  return {
    authorization: `Bearer ${bearerToken}`,
    accept: "application/json, text/event-stream",
    "content-type": "application/json"
  };
}

function createTestApp() {
  return createRemoteHttpApp({
    bearerToken,
    mcpHandler: createRemoteDocsMcpHandler({
      dependencies: createServerDependencies({
        cachePath: tempCachePath(),
        fetchImpl: async () => new Response("", { status: 200 }),
        now: () => "2026-05-14T12:00:00.000Z"
      })
    })
  });
}

async function postMcp(app: ReturnType<typeof createRemoteHttpApp>, body: unknown): Promise<Response> {
  return app.request("/mcp", {
    method: "POST",
    headers: mcpJsonHeaders(),
    body: JSON.stringify(body)
  });
}

async function initialize(app: ReturnType<typeof createRemoteHttpApp>): Promise<unknown> {
  const response = await postMcp(app, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: {
        name: "bun-dev-intel-test",
        version: "0.0.0"
      }
    }
  });

  expect(response.status).toBe(200);
  return response.json();
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("Streamable HTTP MCP entrypoint", () => {
  test("Hono app routes valid authenticated initialization to Streamable HTTP transport", async () => {
    const body = await initialize(createTestApp());

    expect(body).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        serverInfo: {
          name: "bun-dev-intel-mcp",
          version: "0.1.0"
        }
      }
    });
  });

  test("remote HTTP tool list excludes local project tools", async () => {
    const app = createTestApp();

    await initialize(app);
    await postMcp(app, {
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {}
    });
    const response = await postMcp(app, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {}
    });
    const body = (await response.json()) as { result: { tools: Array<{ name: string }> } };
    const toolNames = body.result.tools.map((tool: { name: string }) => tool.name);

    expect(response.status).toBe(200);
    expect(toolNames).toEqual(["search_docs", "get_doc_page", "search_bun_docs"]);
    expect(toolNames).not.toContain("analyze_bun_project");
    expect(toolNames).not.toContain("project_health");
    expect(getRemoteDocsCapabilityManifest().tools.map((tool) => tool.name)).toEqual([
      "search_docs",
      "get_doc_page",
      "search_bun_docs"
    ]);
  });

  test("missing auth never reaches MCP transport", async () => {
    let transportCalls = 0;
    const app = createRemoteHttpApp({
      bearerToken,
      mcpHandler: () => {
        transportCalls += 1;
        return Response.json({ ok: true });
      }
    });

    const response = await app.request("/mcp", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" })
    });

    expect(response.status).toBe(401);
    expect(transportCalls).toBe(0);
  });

  test("GET /mcp and DELETE /mcp are wired to selected SDK support", async () => {
    const app = createTestApp();

    const getResponse = await app.request("/mcp", {
      method: "GET",
      headers: {
        authorization: `Bearer ${bearerToken}`,
        accept: "text/event-stream"
      }
    });
    const deleteResponse = await app.request("/mcp", {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${bearerToken}`
      }
    });

    expect(getResponse.status).toBe(200);
    expect(getResponse.headers.get("content-type")).toContain("text/event-stream");
    expect(deleteResponse.status).toBe(200);
  });

  test("deprecated SSE routes are not present", async () => {
    const app = createTestApp();

    expect((await app.request("/sse", { headers: { authorization: `Bearer ${bearerToken}` } })).status).toBe(404);
    expect((await app.request("/messages", { method: "POST", headers: mcpJsonHeaders() })).status).toBe(404);
  });

  test("importing src/http.ts has no startup side effects and startup failures are structured", async () => {
    const module = await import("../../../src/http");
    let serveCalls = 0;

    const result = module.startRemoteHttpServer({
      bearerToken: "",
      serve: () => {
        serveCalls += 1;
        throw new Error("should not bind");
      }
    });

    expect(module.startRemoteHttpServer).toBeTypeOf("function");
    expect(result).toMatchObject({ ok: false, error: { code: "startup_failed" } });
    expect(serveCalls).toBe(0);
  });
});
