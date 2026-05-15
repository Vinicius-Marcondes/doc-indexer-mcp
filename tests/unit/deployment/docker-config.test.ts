import { describe, expect, test } from "bun:test";

const root = new URL("../../../", import.meta.url);
const requiredEnvNames = [
  "MCP_HTTP_HOST",
  "MCP_HTTP_PORT",
  "MCP_BEARER_TOKEN",
  "DATABASE_URL",
  "EMBEDDING_PROVIDER",
  "OPENAI_API_KEY",
  "OPENAI_EMBEDDING_MODEL",
  "DOCS_REFRESH_INTERVAL",
  "DOCS_REFRESH_RUNNING_TIMEOUT_SECONDS"
] as const;
const adminEnvNames = [
  "ADMIN_HTTP_HOST",
  "ADMIN_HTTP_PORT",
  "ADMIN_SESSION_SECRET",
  "ADMIN_COOKIE_SECURE",
  "ADMIN_BOOTSTRAP_EMAIL",
  "ADMIN_BOOTSTRAP_PASSWORD",
  "ADMIN_SESSION_TTL_SECONDS",
  "ADMIN_LOGIN_RATE_LIMIT_WINDOW_SECONDS",
  "ADMIN_LOGIN_RATE_LIMIT_MAX_ATTEMPTS",
  "ADMIN_AUTH_LOG_LEVEL"
] as const;

async function readText(path: string): Promise<string> {
  return Bun.file(new URL(path, root)).text();
}

function serviceBlock(compose: string, serviceName: string): string {
  const pattern = new RegExp(`\\n  ${serviceName}:\\n(?<block>(?:    .+\\n|\\n)+?)(?=\\n  [a-zA-Z0-9_-]+:|\\nvolumes:|\\nnetworks:|$)`, "u");
  const match = pattern.exec(`\n${compose}`);

  if (match?.groups?.block === undefined) {
    throw new Error(`Missing compose service ${serviceName}.`);
  }

  return match.groups.block;
}

describe("remote docs Docker deployment config", () => {
  test("Dockerfile exists and runs the HTTP entrypoint by default", async () => {
    const dockerfile = await readText("Dockerfile");

    expect(dockerfile).toContain("FROM oven/bun:");
    expect(dockerfile).toContain("bun install --frozen-lockfile");
    expect(dockerfile).not.toContain("--production");
    expect(dockerfile).toContain("EXPOSE 3000");
    expect(dockerfile).toContain('CMD ["bun", "src/http.ts"]');
  });

  test("Dockerfile includes an admin console target that builds the React client", async () => {
    const dockerfile = await readText("Dockerfile");

    expect(dockerfile).toContain("AS admin-console");
    expect(dockerfile).toContain("bun run admin:client:build");
    expect(dockerfile).toContain("apps/admin-console/client/dist");
    expect(dockerfile).toContain("EXPOSE 3100");
    expect(dockerfile).toContain('CMD ["bun", "apps/admin-console/server/src/index.ts"]');
  });

  test("compose example defines server, worker, and Postgres services", async () => {
    const compose = await readText("docker-compose.remote-docs.yml");

    expect(serviceBlock(compose, "mcp-http-server")).toContain("3000:3000");
    expect(serviceBlock(compose, "docs-worker")).toContain("bun src/docs-worker.ts");
    expect(serviceBlock(compose, "postgres-pgvector")).toContain("pgvector/pgvector");
  });

  test("compose admin console is optional and does not receive the MCP bearer token", async () => {
    const compose = await readText("docker-compose.remote-docs.yml");
    const admin = serviceBlock(compose, "admin-console");

    expect(admin).toContain("profiles:");
    expect(admin).toContain("- admin");
    expect(admin).toContain("target: admin-console");
    expect(admin).toContain("3100:3100");
    expect(admin).toContain("ADMIN_HTTP_HOST: 0.0.0.0");
    expect(admin).toContain("ADMIN_HTTP_PORT: 3100");
    expect(admin).toContain("ADMIN_COOKIE_SECURE: ${ADMIN_COOKIE_SECURE:-false}");
    expect(admin).toContain("ADMIN_AUTH_LOG_LEVEL: ${ADMIN_AUTH_LOG_LEVEL:-INFO}");
    expect(admin).toContain("DATABASE_URL:");
    expect(admin).not.toContain("MCP_BEARER_TOKEN");
  });

  test("compose and env example do not contain real-looking secrets", async () => {
    const compose = await readText("docker-compose.remote-docs.yml");
    const env = await readText(".env.remote-docs.example");
    const combined = `${compose}\n${env}`;

    expect(combined).not.toMatch(/sk-[A-Za-z0-9_-]{20,}/u);
    expect(combined).not.toMatch(/MCP_BEARER_TOKEN=(?!\$\{|replace-|change-|example-|your-)[^\s#]{16,}/u);
    expect(combined).not.toMatch(/OPENAI_API_KEY=(?!\$\{|replace-|change-|example-|your-)[^\s#]{16,}/u);
    expect(combined).not.toMatch(/ADMIN_SESSION_SECRET=(?!\$\{|replace-|change-|example-|your-)[^\s#]{16,}/u);
    expect(combined).not.toMatch(/ADMIN_BOOTSTRAP_PASSWORD=(?!\$\{|replace-|change-|example-|your-)[^\s#]{12,}/u);
  });

  test("server and worker commands use separate entrypoints", async () => {
    const compose = await readText("docker-compose.remote-docs.yml");

    expect(serviceBlock(compose, "mcp-http-server")).toContain("bun src/http.ts");
    expect(serviceBlock(compose, "docs-worker")).toContain("bun src/docs-worker.ts");
    expect(serviceBlock(compose, "docs-worker")).not.toContain("src/http.ts");
  });

  test("docs worker service stays alive between worker cycles", async () => {
    const compose = await readText("docker-compose.remote-docs.yml");
    const worker = serviceBlock(compose, "docs-worker");

    expect(worker).toContain("sh -c");
    expect(worker).toContain("while true");
    expect(worker).toContain("bun src/docs-worker.ts");
    expect(worker).toContain("DOCS_WORKER_POLL_SECONDS");
  });

  test("required env variable names are documented", async () => {
    const env = await readText(".env.remote-docs.example");
    const docs = await readText("docs/deployment/remote-docs-http.md");

    for (const name of requiredEnvNames) {
      expect(env).toContain(`${name}=`);
      expect(docs).toContain(name);
    }

    for (const name of adminEnvNames) {
      expect(env).toContain(`${name}=`);
      expect(docs).toContain(name);
    }

    expect(docs).toContain("TLS");
    expect(docs).toContain("bun src/http.ts");
    expect(docs).toContain("bun src/docs-worker.ts");
    expect(docs).toContain("bun apps/admin-console/server/src/index.ts");
    expect(docs).toContain("--profile admin");
    expect(docs).toContain("runRemoteDocsMigrations");
  });

  test("env example and deployment docs cover stale running job recovery", async () => {
    const env = await readText(".env.remote-docs.example");
    const docs = await readText("docs/deployment/remote-docs-http.md");

    expect(env).toContain("DOCS_REFRESH_RUNNING_TIMEOUT_SECONDS=1800");
    expect(docs).toContain("DOCS_REFRESH_RUNNING_TIMEOUT_SECONDS");
    expect(docs).toContain("stale `running`");
  });
});
