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
  "DOCS_REFRESH_INTERVAL"
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
    expect(dockerfile).toContain("bun install");
    expect(dockerfile).toContain("EXPOSE 3000");
    expect(dockerfile).toContain('CMD ["bun", "src/http.ts"]');
  });

  test("compose example defines server, worker, and Postgres services", async () => {
    const compose = await readText("docker-compose.remote-docs.yml");

    expect(serviceBlock(compose, "mcp-http-server")).toContain("3000:3000");
    expect(serviceBlock(compose, "docs-worker")).toContain("bun src/docs-worker.ts");
    expect(serviceBlock(compose, "postgres-pgvector")).toContain("pgvector/pgvector");
  });

  test("compose and env example do not contain real-looking secrets", async () => {
    const compose = await readText("docker-compose.remote-docs.yml");
    const env = await readText(".env.remote-docs.example");
    const combined = `${compose}\n${env}`;

    expect(combined).not.toMatch(/sk-[A-Za-z0-9_-]{20,}/u);
    expect(combined).not.toMatch(/MCP_BEARER_TOKEN=(?!\$\{|replace-|change-|example-|your-)[^\s#]{16,}/u);
    expect(combined).not.toMatch(/OPENAI_API_KEY=(?!\$\{|replace-|change-|example-|your-)[^\s#]{16,}/u);
  });

  test("server and worker commands use separate entrypoints", async () => {
    const compose = await readText("docker-compose.remote-docs.yml");

    expect(serviceBlock(compose, "mcp-http-server")).toContain("bun src/http.ts");
    expect(serviceBlock(compose, "docs-worker")).toContain("bun src/docs-worker.ts");
    expect(serviceBlock(compose, "docs-worker")).not.toContain("src/http.ts");
  });

  test("required env variable names are documented", async () => {
    const env = await readText(".env.remote-docs.example");
    const docs = await readText("docs/deployment/remote-docs-http.md");

    for (const name of requiredEnvNames) {
      expect(env).toContain(`${name}=`);
      expect(docs).toContain(name);
    }

    expect(docs).toContain("TLS");
    expect(docs).toContain("bun src/http.ts");
    expect(docs).toContain("bun src/docs-worker.ts");
    expect(docs).toContain("runRemoteDocsMigrations");
  });
});
