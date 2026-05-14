import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const rootDir = resolve(import.meta.dir, "../../..");

async function readText(path: string): Promise<string> {
  return Bun.file(resolve(rootDir, path)).text();
}

describe("remote docs HTTP handoff documentation", () => {
  test("deployment documentation covers operation, security, refresh, source, and quality topics", async () => {
    const docs = await readText("docs/deployment/remote-docs-http.md");

    for (const expected of [
      "/mcp",
      "MCP_BEARER_TOKEN",
      "docker-compose.remote-docs.yml",
      "bun src/http.ts",
      "bun src/docs-worker.ts",
      "local stdio",
      "remote HTTP",
      "docs-only",
      "scheduled refresh",
      "on-demand refresh",
      "EMBEDDING_PROVIDER",
      "OPENAI_API_KEY",
      "OPENAI_EMBEDDING_MODEL",
      "https://bun.com/docs/llms.txt",
      "https://bun.com/docs/llms-full.txt",
      "bun test",
      "bun run typecheck",
      "bun run check"
    ]) {
      expect(docs).toContain(expected);
    }
  });

  test("traceability checklist maps PRD requirements to implementation and tests", async () => {
    const traceability = await readText("docs/tasks/bun-dev-intel-mcp-remote-docs-http/traceability-checklist.md");

    expect(traceability).toContain("| PRD requirement | Implementation file(s) | Test file(s) | Status |");
    expect(traceability).toContain("tests/e2e/remote-docs-http-flow.test.ts");

    for (const requirement of [
      "Streamable HTTP MCP endpoint",
      "Bearer token authentication",
      "Docs-only remote capabilities",
      "Local stdio remains intact",
      "Official Bun source policy",
      "Postgres and pgvector storage",
      "Hybrid keyword and semantic retrieval",
      "Documentation page and chunk retrieval",
      "Scheduled and on-demand refresh",
      "Docker deployment"
    ]) {
      expect(traceability).toContain(requirement);
    }

    expect(traceability).not.toContain("| todo |");
    expect(traceability).not.toContain("| blocked |");
  });
});
