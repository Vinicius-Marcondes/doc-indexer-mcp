import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FindingCacheStore } from "../../src/cache/finding-cache";
import { SqliteCacheStore } from "../../src/cache/sqlite-cache";
import { missingCitationReferences, type AgentResponseEnvelope } from "../../src/shared/agent-output";
import { BunDocsSearchAdapter } from "../../src/sources/bun-docs-search";
import { NpmRegistryAdapter, npmRegistryPackageUrl } from "../../src/sources/npm-registry";
import { SourceFetchClient, type FetchLike } from "../../src/sources/fetch-client";
import { readBunProjectFindingsResource } from "../../src/resources/bun-project-findings-resource";
import { checkBeforeInstall } from "../../src/tools/check-before-install";
import { checkBunApiUsage } from "../../src/tools/check-bun-api-usage";
import { lintBunFile } from "../../src/tools/lint-bun-file";
import { projectHealth } from "../../src/tools/project-health";

const testDir = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(testDir, "../fixtures/projects");
const tempDirs: string[] = [];

const mockedDocs = `# HTTP server
URL: https://bun.com/docs/api/http
Bun.serve starts an HTTP server. Use Bun.serve with a fetch handler that returns a Response.

# bun:test
URL: https://bun.com/docs/test
The bun:test module provides test and expect APIs for Bun tests.
`;

function tempPath(label: string): string {
  const dir = mkdtempSync(resolve(tmpdir(), label));
  tempDirs.push(dir);
  return resolve(dir, "cache.sqlite");
}

function docsAdapter(): BunDocsSearchAdapter {
  return new BunDocsSearchAdapter({
    cache: new SqliteCacheStore(tempPath("bun-dev-intel-v2-docs-")),
    fetchClient: new SourceFetchClient({
      fetchImpl: async () => new Response(mockedDocs, { status: 200 }),
      now: () => "2026-05-12T10:00:00.000Z"
    }),
    now: () => "2026-05-12T10:00:00.000Z"
  });
}

function registryFetch(packages: Record<string, unknown>): FetchLike {
  return async (url) => {
    const entry = Object.entries(packages).find(([name]) => url === npmRegistryPackageUrl(name));
    return entry === undefined
      ? new Response("missing", { status: 404, statusText: "Not Found" })
      : new Response(JSON.stringify(entry[1]), { status: 200 });
  };
}

function registryAdapter(): NpmRegistryAdapter {
  return new NpmRegistryAdapter({
    cache: new SqliteCacheStore(tempPath("bun-dev-intel-v2-registry-")),
    fetchClient: new SourceFetchClient({
      fetchImpl: registryFetch({
        typescript: {
          name: "typescript",
          "dist-tags": { latest: "5.9.3" },
          versions: {
            "5.9.3": {
              name: "typescript",
              version: "5.9.3",
              engines: { node: ">=14.17" }
            }
          },
          time: { "5.9.3": "2026-01-01T00:00:00.000Z" }
        }
      }),
      now: () => "2026-05-12T10:00:00.000Z"
    }),
    now: () => "2026-05-12T10:00:00.000Z"
  });
}

function expectResolvedCitations(response: AgentResponseEnvelope): void {
  expect(missingCitationReferences(response)).toEqual([]);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("Agent Output V2 end-to-end flow", () => {
  test("agent workflow stays compact, cited, and action-safe", async () => {
    const projectPath = resolve(fixturesDir, "missing-bun-types");
    const findingCache = new FindingCacheStore(tempPath("bun-dev-intel-v2-findings-"));

    const health = projectHealth({ projectPath }, { findingCache });
    expect(health.ok).toBe(true);

    if (!health.ok) {
      return;
    }

    expect(health.responseMode).toBe("brief");
    expect(health.summary.length).toBeLessThanOrEqual(500);
    expect(health.deltaToken).toBeTypeOf("string");
    expectResolvedCitations(health);

    const api = await checkBunApiUsage({ apiName: "Bun.serve" }, { docsAdapter: docsAdapter() });
    expect(api.ok).toBe(true);

    if (!api.ok) {
      return;
    }

    expect(api.examples).toHaveLength(1);
    expect(api.examples[0]?.code).toContain("Bun.serve");
    expectResolvedCitations(api);

    const install = await checkBeforeInstall(
      { projectPath, packages: [{ name: "typescript" }], dependencyType: "devDependencies" },
      { registryAdapter: registryAdapter() }
    );
    expect(install.ok).toBe(true);

    if (!install.ok) {
      return;
    }

    expect(install.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "command", command: "bun add -d typescript", requiresApproval: true })
      ])
    );
    expectResolvedCitations(install);

    const lint = lintBunFile({ projectPath, filePath: "src/index.ts" });
    expect(lint.ok).toBe(true);

    if (!lint.ok) {
      return;
    }

    expect(lint.findings.some((finding) => finding.ruleId === "bun-global-usage")).toBe(true);
    expect(lint.findings.every((finding) => finding.locations.length === 0 || finding.locations[0]?.filePath === "src/index.ts")).toBe(
      true
    );
    expectResolvedCitations(lint);

    const repeatedHealth = projectHealth({ projectPath, sinceToken: health.deltaToken }, { findingCache });
    expect(repeatedHealth.ok).toBe(true);

    if (!repeatedHealth.ok) {
      return;
    }

    expect(repeatedHealth.delta?.repeatedFindingIds.length).toBeGreaterThan(0);
    expect(repeatedHealth.findings.length).toBeLessThanOrEqual(health.findings.length);
    expectResolvedCitations(repeatedHealth);

    const findingsResource = readBunProjectFindingsResource({ projectHash: health.projectHash }, { store: findingCache });
    expect(findingsResource.ok).toBe(true);

    if (findingsResource.ok) {
      expect(findingsResource.findings.length).toBeGreaterThan(0);
      expect(Object.keys(findingsResource.citations).length).toBeGreaterThan(0);
    }

    findingCache.close();
  });
});
