import { describe, expect, test } from "bun:test";
import { parseRemoteDocsConfig } from "../../../src/config/remote-docs-config";

function validEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    MCP_HTTP_HOST: "127.0.0.1",
    MCP_HTTP_PORT: "3000",
    MCP_BEARER_TOKEN: "remote-docs-token-1234567890",
    DATABASE_URL: "postgres://docs:docs-password@localhost:5432/docs",
    EMBEDDING_PROVIDER: "openai",
    OPENAI_API_KEY: "sk-test-openai-key",
    OPENAI_EMBEDDING_MODEL: "text-embedding-3-small",
    ...overrides
  };
}

describe("remote docs runtime config", () => {
  test("valid minimal env parses", () => {
    const result = parseRemoteDocsConfig(
      validEnv({
        DOCS_ALLOWED_ORIGINS: "https://agent.example.com, https://admin.example.com",
        MCP_HTTP_MAX_REQUEST_BODY_BYTES: "2048"
      })
    );

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.config.http).toMatchObject({
      host: "127.0.0.1",
      port: 3000,
      bearerToken: "remote-docs-token-1234567890",
      allowedOrigins: ["https://agent.example.com", "https://admin.example.com"],
      maxRequestBodyBytes: 2048
    });
    expect(result.config.database.url).toBe("postgres://docs:docs-password@localhost:5432/docs");
    expect(result.config.embeddings).toMatchObject({
      provider: "openai",
      apiKey: "sk-test-openai-key",
      model: "text-embedding-3-small"
    });
    expect(result.config.search).toEqual({ defaultLimit: 5, maxLimit: 20 });
    expect(result.config.refresh.interval).toEqual({ raw: "7d", seconds: 604800 });
  });

  test("missing bearer token fails", () => {
    const result = parseRemoteDocsConfig(validEnv({ MCP_BEARER_TOKEN: undefined }));

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.issues).toContainEqual({
      path: "MCP_BEARER_TOKEN",
      message: "MCP_BEARER_TOKEN is required."
    });
  });

  test("weak placeholder bearer token fails outside test mode", () => {
    const result = parseRemoteDocsConfig(validEnv({ MCP_BEARER_TOKEN: "changeme" }));

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error.issues.map((issue) => issue.path).join(",")).toContain("MCP_BEARER_TOKEN");
  });

  test("weak bearer token is allowed only in explicit test mode", () => {
    const result = parseRemoteDocsConfig(validEnv({ MCP_BEARER_TOKEN: "changeme", REMOTE_DOCS_CONFIG_MODE: "test" }));

    expect(result.ok).toBe(true);
  });

  test("missing database URL fails", () => {
    const result = parseRemoteDocsConfig(validEnv({ DATABASE_URL: undefined }));

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.issues).toContainEqual({
      path: "DATABASE_URL",
      message: "DATABASE_URL is required."
    });
  });

  test("invalid port fails", () => {
    const result = parseRemoteDocsConfig(validEnv({ MCP_HTTP_PORT: "70000" }));

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error.issues.map((issue) => issue.path).join(",")).toContain("MCP_HTTP_PORT");
  });

  test("invalid refresh interval fails", () => {
    const result = parseRemoteDocsConfig(validEnv({ DOCS_REFRESH_INTERVAL: "weekly" }));

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error.issues.map((issue) => issue.path).join(",")).toContain("DOCS_REFRESH_INTERVAL");
  });

  test("default search limit above max fails", () => {
    const result = parseRemoteDocsConfig(
      validEnv({
        DOCS_SEARCH_DEFAULT_LIMIT: "25",
        DOCS_SEARCH_MAX_LIMIT: "20"
      })
    );

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error.issues.map((issue) => issue.path).join(",")).toContain("DOCS_SEARCH_DEFAULT_LIMIT");
  });

  test("secrets are redacted from error output", () => {
    const result = parseRemoteDocsConfig(
      validEnv({
        MCP_BEARER_TOKEN: "super-secret-bearer-token-value",
        DATABASE_URL: "postgres://secret-user:secret-pass@localhost:5432/docs",
        OPENAI_API_KEY: "sk-secret-openai-key",
        DOCS_SEARCH_DEFAULT_LIMIT: "25",
        DOCS_SEARCH_MAX_LIMIT: "20"
      })
    );

    expect(result.ok).toBe(false);

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("super-secret-bearer-token-value");
    expect(serialized).not.toContain("secret-pass");
    expect(serialized).not.toContain("sk-secret-openai-key");
  });
});
