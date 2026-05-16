import { describe, expect, test } from "bun:test";

const root = new URL("../../../", import.meta.url);
const requiredEnvNames = [
  "MCP_HTTP_HOST",
  "MCP_HTTP_PORT",
  "MCP_BEARER_TOKEN",
  "ADMIN_HTTP_HOST",
  "ADMIN_HTTP_PORT",
  "ADMIN_AUTH_LOG_LEVEL",
  "DATABASE_URL",
  "EMBEDDING_PROVIDER",
  "OPENAI_API_KEY",
  "OPENAI_EMBEDDING_MODEL",
  "DOCS_REFRESH_INTERVAL",
  "DOCS_REFRESH_RUNNING_TIMEOUT_SECONDS"
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
  test("Dockerfile exists and runs migrations before the MCP HTTP app entrypoint by default", async () => {
    const dockerfile = await readText("Dockerfile");
    const packageJson = JSON.parse(await readText("package.json")) as {
      readonly scripts?: Record<string, string>;
    };

    expect(dockerfile).toContain("FROM oven/bun:");
    expect(dockerfile).toContain("bun install --frozen-lockfile");
    expect(dockerfile).not.toContain("--production");
    expect(dockerfile).toContain("COPY apps ./apps");
    expect(dockerfile).toContain("COPY packages ./packages");
    expect(dockerfile).toContain("COPY scripts ./scripts");
    expect(dockerfile).toContain("bun run admin:client:build");
    expect(dockerfile).toContain("EXPOSE 3000");
    expect(dockerfile).toContain("EXPOSE 3100");
    expect(dockerfile).toContain('CMD ["sh", "-c", "bun run db:migrate && exec bun apps/mcp-http/src/index.ts"]');
    expect(packageJson.scripts?.["db:migrate"]).toBe("bun scripts/db-migrate.ts");
  });

  test("migration script uses a local package path that resolves from the root package", async () => {
    const script = await readText("scripts/db-migrate.ts");

    expect(script).toContain("../packages/db/src/index.ts");
    expect(script).not.toContain("@bun-dev-intel/db");
    expect(script).toContain("runRemoteDocsMigrations");
    expect(script).toContain("DATABASE_URL is required");
  });

  test("compose example defines server, worker, optional admin, and Postgres services", async () => {
    const compose = await readText("docker-compose.yml");

    expect(serviceBlock(compose, "mcp-http-server")).toContain("3000:3000");
    expect(serviceBlock(compose, "docs-worker")).toContain("bun apps/docs-worker/src/index.ts");
    expect(serviceBlock(compose, "admin-console")).toContain("3100:3100");
    expect(serviceBlock(compose, "admin-console")).toContain("profiles:");
    expect(serviceBlock(compose, "admin-console")).toContain("admin");
    expect(serviceBlock(compose, "postgres-pgvector")).toContain("pgvector/pgvector");
  });

  test("compose admin service is optional and does not receive MCP transport configuration directly", async () => {
    const compose = await readText("docker-compose.yml");
    const admin = serviceBlock(compose, "admin-console");

    expect(admin).toContain('["admin"]');
    expect(admin).toContain("ADMIN_HTTP_HOST: 0.0.0.0");
    expect(admin).toContain("ADMIN_HTTP_PORT: 3100");
    expect(admin).not.toContain("MCP_BEARER_TOKEN");
    expect(admin).not.toContain("env_file");
  });

  test("compose services do not inject unrelated secret scopes through env_file", async () => {
    const compose = await readText("docker-compose.yml");

    for (const serviceName of ["mcp-http-server", "docs-worker", "admin-console"]) {
      expect(serviceBlock(compose, serviceName)).not.toContain("env_file");
    }

    expect(serviceBlock(compose, "mcp-http-server")).not.toContain("ADMIN_BOOTSTRAP_PASSWORD");
    expect(serviceBlock(compose, "docs-worker")).not.toContain("ADMIN_BOOTSTRAP_PASSWORD");
    expect(serviceBlock(compose, "admin-console")).not.toContain("MCP_BEARER_TOKEN");
  });

  test("compose and env example do not contain real-looking secrets", async () => {
    const compose = await readText("docker-compose.yml");
    const env = await readText(".env.example");
    const combined = `${compose}\n${env}`;

    expect(combined).not.toMatch(/sk-[A-Za-z0-9_-]{20,}/u);
    expect(combined).not.toMatch(/MCP_BEARER_TOKEN=(?!\$\{|replace-|change-|example-|your-)[^\s#]{16,}/u);
    expect(combined).not.toMatch(/OPENAI_API_KEY=(?!\$\{|replace-|change-|example-|your-)[^\s#]{16,}/u);
    expect(combined).not.toMatch(/ADMIN_BOOTSTRAP_PASSWORD=(?!\$\{|replace-|change-|example-|your-)[^\s#]{16,}/u);
    expect(combined).not.toContain("ADMIN_SESSION_SECRET");
  });

  test("server and worker commands use separate entrypoints", async () => {
    const compose = await readText("docker-compose.yml");

    expect(serviceBlock(compose, "mcp-http-server")).toContain("bun run db:migrate");
    expect(serviceBlock(compose, "mcp-http-server")).toContain("exec bun apps/mcp-http/src/index.ts");
    expect(serviceBlock(compose, "mcp-http-server")).toContain("bun apps/mcp-http/src/index.ts");
    expect(serviceBlock(compose, "docs-worker")).toContain("bun apps/docs-worker/src/index.ts");
    expect(serviceBlock(compose, "admin-console")).toContain("bun apps/admin-console/server/src/index.ts");
    expect(serviceBlock(compose, "docs-worker")).not.toContain("apps/mcp-http/src/index.ts");
  });

  test("docs worker service stays alive between worker cycles", async () => {
    const compose = await readText("docker-compose.yml");
    const worker = serviceBlock(compose, "docs-worker");

    expect(worker).toContain("sh -c");
    expect(worker).toContain("while true");
    expect(worker).toContain("bun apps/docs-worker/src/index.ts");
    expect(worker).toContain("DOCS_WORKER_POLL_SECONDS");
  });

  test("docs worker service receives shared remote docs config required at startup", async () => {
    const compose = await readText("docker-compose.yml");
    const worker = serviceBlock(compose, "docs-worker");

    expect(worker).toContain("MCP_HTTP_HOST: ${MCP_HTTP_HOST:-0.0.0.0}");
    expect(worker).toContain("MCP_HTTP_PORT: ${MCP_HTTP_PORT:-3000}");
    expect(worker).toContain("MCP_BEARER_TOKEN:");
  });

  test("docs worker waits for MCP health so startup migrations finish first", async () => {
    const compose = await readText("docker-compose.yml");
    const worker = serviceBlock(compose, "docs-worker");

    expect(worker).toContain("mcp-http-server:");
    expect(worker).toContain("condition: service_healthy");
  });

  test("required env variable names are documented", async () => {
    const env = await readText(".env.example");
    const docs = await readText("docs/deployment/remote-docs-http.md");

    for (const name of requiredEnvNames) {
      expect(env).toContain(`${name}=`);
      expect(docs).toContain(name);
    }

    expect(docs).toContain("TLS");
    expect(docs).toContain("bun apps/mcp-http/src/index.ts");
    expect(docs).toContain("bun apps/docs-worker/src/index.ts");
    expect(docs).toContain("bun apps/admin-console/server/src/index.ts");
    expect(docs).toContain("--profile admin");
    expect(docs).toContain("bun run db:migrate");
  });

  test("env example and deployment docs cover stale running job recovery", async () => {
    const env = await readText(".env.example");
    const docs = await readText("docs/deployment/remote-docs-http.md");

    expect(env).toContain("DOCS_REFRESH_RUNNING_TIMEOUT_SECONDS=1800");
    expect(docs).toContain("DOCS_REFRESH_RUNNING_TIMEOUT_SECONDS");
    expect(docs).toContain("stale `running`");
  });
});
