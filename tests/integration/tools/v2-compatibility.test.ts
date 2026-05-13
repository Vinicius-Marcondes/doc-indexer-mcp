import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SqliteCacheStore } from "../../../src/cache/sqlite-cache";
import { getServerCapabilityManifest } from "../../../src/server";
import { validateAgentResponseEnvelope } from "../../../src/shared/agent-output";
import { NpmRegistryAdapter, npmRegistryPackageUrl } from "../../../src/sources/npm-registry";
import { SourceFetchClient, type FetchLike } from "../../../src/sources/fetch-client";
import { planBunDependency } from "../../../src/tools/plan-bun-dependency";
import { reviewBunProject } from "../../../src/tools/review-bun-project";

const testDir = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(testDir, "../../fixtures/projects");
const tempDirs: string[] = [];

function packageMetadata(name: string) {
  return {
    name,
    "dist-tags": { latest: "1.0.0" },
    versions: {
      "1.0.0": {
        name,
        version: "1.0.0"
      }
    },
    time: { "1.0.0": "2026-01-01T00:00:00.000Z" }
  };
}

function tempProject(): string {
  const dir = mkdtempSync(resolve(tmpdir(), "bun-dev-intel-v2-compat-"));
  tempDirs.push(dir);
  writeFileSync(resolve(dir, "package.json"), JSON.stringify({ type: "module" }));
  writeFileSync(resolve(dir, "bun.lock"), "");
  return dir;
}

function createAdapter(fetchImpl: FetchLike): NpmRegistryAdapter {
  const dir = mkdtempSync(resolve(tmpdir(), "bun-dev-intel-v2-compat-registry-"));
  tempDirs.push(dir);
  return new NpmRegistryAdapter({
    cache: new SqliteCacheStore(resolve(dir, "cache.sqlite")),
    fetchClient: new SourceFetchClient({
      fetchImpl,
      now: () => "2026-05-12T10:00:00.000Z"
    }),
    now: () => "2026-05-12T10:00:00.000Z"
  });
}

function registryFetch(packages: Record<string, unknown>): FetchLike {
  return async (url) => {
    const entry = Object.entries(packages).find(([name]) => url === npmRegistryPackageUrl(name));

    if (entry === undefined) {
      return new Response("missing", { status: 404, statusText: "Not Found" });
    }

    return new Response(JSON.stringify(entry[1]), { status: 200 });
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("V2 compatibility for existing tools", () => {
  test("existing V1 tools remain in the manifest", () => {
    expect(getServerCapabilityManifest().tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "analyze_bun_project",
        "search_bun_docs",
        "get_bun_best_practices",
        "plan_bun_dependency",
        "review_bun_project"
      ])
    );
  });

  test("review_bun_project returns V2 envelope when responseMode is requested", () => {
    const result = reviewBunProject({
      projectPath: resolve(fixturesDir, "mixed-lockfiles"),
      responseMode: "brief"
    });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.responseMode).toBe("brief");
      const { projectProfile: _projectProfile, ...envelope } = result;
      validateAgentResponseEnvelope(envelope);
    }
  });

  test("plan_bun_dependency exposes structured action data in V2 mode", async () => {
    const result = await planBunDependency(
      { projectPath: tempProject(), packages: [{ name: "zod" }], responseMode: "brief" },
      { registryAdapter: createAdapter(registryFetch({ zod: packageMetadata("zod") })) }
    );

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.actions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: "command", command: "bun add zod", requiresApproval: true })
        ])
      );
    }
  });

  test("tool descriptions steer agents toward task-shaped tools", () => {
    const manifest = getServerCapabilityManifest();
    const analyzeDescription = manifest.tools.find((tool) => tool.name === "analyze_bun_project")?.description ?? "";
    const dependencyDescription = manifest.tools.find((tool) => tool.name === "plan_bun_dependency")?.description ?? "";

    expect(analyzeDescription).toContain("project_health");
    expect(dependencyDescription).toContain("check_before_install");
  });
});
