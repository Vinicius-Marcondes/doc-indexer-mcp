import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { SqliteCacheStore } from "../../../src/cache/sqlite-cache";
import { validateAgentResponseEnvelope } from "../../../src/shared/agent-output";
import { BunDocsSearchAdapter } from "../../../src/sources/bun-docs-search";
import { SourceFetchClient, type FetchLike } from "../../../src/sources/fetch-client";
import { checkBunApiUsage } from "../../../src/tools/check-bun-api-usage";

const tempDirs: string[] = [];

const mockedDocs = `# HTTP server
URL: https://bun.com/docs/api/http
Bun.serve starts an HTTP server. Use Bun.serve with a fetch handler that returns a Response.

# bun:test
URL: https://bun.com/docs/test
The bun:test module provides test, expect, beforeEach, and afterEach APIs for Bun tests.
`;

function createAdapter(fetchImpl: FetchLike): BunDocsSearchAdapter {
  const dir = mkdtempSync(resolve(tmpdir(), "bun-dev-intel-api-usage-docs-"));
  tempDirs.push(dir);
  return new BunDocsSearchAdapter({
    cache: new SqliteCacheStore(resolve(dir, "cache.sqlite")),
    fetchClient: new SourceFetchClient({
      fetchImpl,
      now: () => "2026-05-12T10:00:00.000Z"
    }),
    now: () => "2026-05-12T10:00:00.000Z"
  });
}

function validateEnvelopePortion(result: Extract<Awaited<ReturnType<typeof checkBunApiUsage>>, { ok: true }>): void {
  const { apiName: _apiName, usageClassification: _usageClassification, ...envelope } = result;
  validateAgentResponseEnvelope(envelope);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("check_bun_api_usage tool", () => {
  test("Bun.serve query returns a docs-backed finding", async () => {
    const result = await checkBunApiUsage(
      { apiName: "Bun.serve" },
      { docsAdapter: createAdapter(async () => new Response(mockedDocs, { status: 200 })) }
    );

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.findings[0]).toMatchObject({
        ruleId: "bun-api-docs-match",
        severity: "info"
      });
      expect(result.findings[0]?.citationIds.length).toBeGreaterThan(0);
      validateEnvelopePortion(result);
    }
  });

  test("API-shaped query returns at most one example in brief mode", async () => {
    const result = await checkBunApiUsage(
      { apiName: "Bun.serve" },
      { docsAdapter: createAdapter(async () => new Response(mockedDocs, { status: 200 })) }
    );

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.responseMode).toBe("brief");
      expect(result.examples.length).toBeLessThanOrEqual(1);
      expect(result.examples[0]?.code).toContain("Bun.serve");
    }
  });

  test("unknown API returns low confidence and no fabricated guidance", async () => {
    const result = await checkBunApiUsage(
      { apiName: "Bun.notARealApi" },
      { docsAdapter: createAdapter(async () => new Response(mockedDocs, { status: 200 })) }
    );

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.confidence).toBe("low");
      expect(result.findings).toHaveLength(0);
      expect(result.examples).toHaveLength(0);
      expect(result.summary).toContain("No official Bun docs match");
    }
  });

  test("provided snippet classification is unknown when docs evidence is insufficient", async () => {
    const result = await checkBunApiUsage(
      {
        apiName: "Bun.notARealApi",
        usageSnippet: "Bun.notARealApi();"
      },
      { docsAdapter: createAdapter(async () => new Response(mockedDocs, { status: 200 })) }
    );

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.usageClassification).toBe("unknown");
    }
  });

  test("agentTrainingCutoff only affects output when source dates prove recency", async () => {
    const result = await checkBunApiUsage(
      { apiName: "Bun.serve", agentTrainingCutoff: "2025-01-01" },
      { docsAdapter: createAdapter(async () => new Response(mockedDocs, { status: 200 })) }
    );

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.findings.every((finding) => finding.change?.afterAgentTrainingCutoff !== true)).toBe(true);
      expect(result.warnings.map((warning) => warning.id)).toContain("change-metadata-date-unavailable");
    }
  });
});
