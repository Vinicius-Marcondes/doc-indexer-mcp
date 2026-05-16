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
      "docker-compose.yml",
      "bun apps/mcp-http/src/index.ts",
      "bun apps/docs-worker/src/index.ts",
      "bun apps/admin-console/server/src/index.ts",
      "bun-dev-intel-stdio-mcp",
      "admin console",
      "remote HTTP",
      "docs-only",
      "scheduled refresh",
      "on-demand refresh",
      "Monitoring",
      "doc_refresh_jobs",
      "doc_pages",
      "doc_chunks",
      "doc_embeddings",
      "DOCS_REFRESH_RUNNING_TIMEOUT_SECONDS",
      "stale `running`",
      "worker container can be `Up`",
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
      "Official Bun source policy",
      "Postgres and pgvector storage",
      "Hybrid keyword and semantic retrieval",
      "Documentation page and chunk retrieval",
      "Scheduled and on-demand refresh",
      "Docker deployment",
      "Remote HTTP excludes local project analysis"
    ]) {
      expect(traceability).toContain(requirement);
    }

    expect(traceability).not.toContain("| todo |");
    expect(traceability).not.toContain("| blocked |");
  });

  test("worker reliability traceability maps PRD requirements to implementation and tests", async () => {
    const traceability = await readText("docs/tasks/bun-dev-intel-mcp-remote-docs-worker-reliability/traceability-checklist.md");

    expect(traceability).toContain("| PRD requirement | Implementation file(s) | Test file(s) | Status |");

    for (const requirement of [
      "Idempotent embedding insert",
      "Per-job exception handling",
      "Stale running job recovery",
      "Source-level job exclusivity",
      "Safe worker failure logs",
      "Running timeout configuration",
      "Remote HTTP remains docs-only",
      "Admin console remains a separate optional process"
    ]) {
      expect(traceability).toContain(requirement);
    }

    expect(traceability).toContain("tests/integration/mcp/streamable-http-entrypoint.test.ts");
    expect(traceability).toContain("tests/unit/http-import-boundary.test.ts");
    expect(traceability).not.toContain("| todo |");
    expect(traceability).not.toContain("| blocked |");
  });
});
