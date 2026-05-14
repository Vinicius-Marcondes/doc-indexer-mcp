import { describe, expect, test } from "bun:test";
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
});
