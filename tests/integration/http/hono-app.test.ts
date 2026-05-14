import { describe, expect, test } from "bun:test";
import { parseRemoteDocsConfig } from "../../../src/config/remote-docs-config";
import { createDatabaseReadinessCheck, type SqlClient } from "../../../src/docs/storage/database";
import { createRemoteHttpApp } from "../../../src/http/app";

const bearerToken = "test-token";

function authHeaders(origin?: string): Record<string, string> {
  return {
    authorization: `Bearer ${bearerToken}`,
    ...(origin === undefined ? {} : { origin })
  };
}

describe("remote Hono HTTP shell", () => {
  test("GET /healthz returns ok without auth and without readiness checks", async () => {
    let readinessChecks = 0;
    const app = createRemoteHttpApp({
      bearerToken,
      readinessCheck: () => {
        readinessChecks += 1;
        return { ok: true };
      }
    });

    const response = await app.request("/healthz");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, status: "ok" });
    expect(readinessChecks).toBe(0);
  });

  test("GET /readyz reports ready when dependency checks pass", async () => {
    const app = createRemoteHttpApp({
      bearerToken,
      readinessCheck: () => ({ ok: true, details: { database: "ready" } })
    });

    const response = await app.request("/readyz");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, status: "ready", details: { database: "ready" } });
  });

  test("GET /readyz reports unavailable when dependency checks fail", async () => {
    const app = createRemoteHttpApp({
      bearerToken,
      readinessCheck: () => ({ ok: false, message: "database unavailable" })
    });

    const response = await app.request("/readyz");
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      ok: false,
      error: {
        code: "not_ready",
        message: "database unavailable"
      }
    });
  });

  test("GET /readyz passes with a mocked DB readiness check", async () => {
    const sql = (() => Promise.resolve([{ ready: 1 }])) as unknown as SqlClient;
    const app = createRemoteHttpApp({
      bearerToken,
      readinessCheck: createDatabaseReadinessCheck(sql)
    });

    const response = await app.request("/readyz");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, status: "ready", details: { database: "ready" } });
  });

  test("GET /readyz fails when mocked DB readiness check fails", async () => {
    const sql = (() => Promise.reject(new Error("database down"))) as unknown as SqlClient;
    const app = createRemoteHttpApp({
      bearerToken,
      readinessCheck: createDatabaseReadinessCheck(sql)
    });

    const response = await app.request("/readyz");
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({ ok: false, error: { code: "not_ready", message: "Database is not ready." } });
  });

  test("/mcp rejects missing bearer token", async () => {
    const app = createRemoteHttpApp({ bearerToken });

    const response = await app.request("/mcp", { method: "POST" });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ ok: false, error: { code: "unauthorized" } });
  });

  test("/mcp rejects invalid bearer token", async () => {
    const app = createRemoteHttpApp({ bearerToken });

    const response = await app.request("/mcp", {
      method: "POST",
      headers: { authorization: "Bearer wrong-token" }
    });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ ok: false, error: { code: "unauthorized" } });
  });

  test("/mcp rejects bearer token in query string", async () => {
    const app = createRemoteHttpApp({ bearerToken });

    const response = await app.request("/mcp?access_token=test-token", {
      method: "POST",
      headers: authHeaders()
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ ok: false, error: { code: "token_in_query_rejected" } });
  });

  test("/mcp accepts valid bearer token and reaches placeholder handler", async () => {
    const app = createRemoteHttpApp({
      bearerToken,
      mcpPlaceholderHandler: (c) => c.json({ ok: true, reachedPlaceholder: true }, 202)
    });

    const response = await app.request("/mcp", {
      method: "POST",
      headers: authHeaders()
    });
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body).toEqual({ ok: true, reachedPlaceholder: true });
  });

  test("invalid Origin is rejected when allowed origins are configured", async () => {
    const app = createRemoteHttpApp({
      bearerToken,
      allowedOrigins: ["https://agent.example.com"]
    });

    const response = await app.request("/mcp", {
      method: "POST",
      headers: authHeaders("https://evil.example.com")
    });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ ok: false, error: { code: "origin_forbidden" } });
  });

  test("oversized MCP request body is rejected before placeholder handling", async () => {
    let placeholderCalls = 0;
    const app = createRemoteHttpApp({
      bearerToken,
      maxRequestBodyBytes: 8,
      mcpPlaceholderHandler: (c) => {
        placeholderCalls += 1;
        return c.json({ ok: true });
      }
    });

    const response = await app.request("/mcp", {
      method: "POST",
      headers: {
        ...authHeaders(),
        "content-type": "application/json"
      },
      body: JSON.stringify({ tooLarge: true })
    });
    const body = await response.json();

    expect(response.status).toBe(413);
    expect(body).toMatchObject({ ok: false, error: { code: "request_body_too_large" } });
    expect(placeholderCalls).toBe(0);
  });

  test("app uses parsed config for auth, origin, and body limit behavior", async () => {
    const parsed = parseRemoteDocsConfig({
      MCP_HTTP_HOST: "127.0.0.1",
      MCP_HTTP_PORT: "3000",
      MCP_BEARER_TOKEN: "remote-docs-token-1234567890",
      DATABASE_URL: "postgres://docs:docs-password@localhost:5432/docs",
      EMBEDDING_PROVIDER: "openai",
      OPENAI_API_KEY: "sk-test-openai-key",
      OPENAI_EMBEDDING_MODEL: "text-embedding-3-small",
      DOCS_ALLOWED_ORIGINS: "https://agent.example.com",
      MCP_HTTP_MAX_REQUEST_BODY_BYTES: "12"
    });

    expect(parsed.ok).toBe(true);

    if (!parsed.ok) {
      return;
    }

    const app = createRemoteHttpApp({
      bearerToken: parsed.config.http.bearerToken,
      allowedOrigins: parsed.config.http.allowedOrigins,
      maxRequestBodyBytes: parsed.config.http.maxRequestBodyBytes,
      mcpPlaceholderHandler: (c) => c.json({ ok: true })
    });

    const accepted = await app.request("/mcp", {
      method: "POST",
      headers: {
        authorization: `Bearer ${parsed.config.http.bearerToken}`,
        origin: "https://agent.example.com"
      },
      body: "{}"
    });
    const rejectedOrigin = await app.request("/mcp", {
      method: "POST",
      headers: {
        authorization: `Bearer ${parsed.config.http.bearerToken}`,
        origin: "https://evil.example.com"
      },
      body: "{}"
    });
    const rejectedBody = await app.request("/mcp", {
      method: "POST",
      headers: {
        authorization: `Bearer ${parsed.config.http.bearerToken}`,
        origin: "https://agent.example.com",
        "content-type": "application/json"
      },
      body: JSON.stringify({ tooLarge: true })
    });

    expect(accepted.status).toBe(200);
    expect(rejectedOrigin.status).toBe(403);
    expect(rejectedBody.status).toBe(413);
  });
});
