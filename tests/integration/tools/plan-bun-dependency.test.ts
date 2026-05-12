import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { SqliteCacheStore } from "../../../src/cache/sqlite-cache";
import { NpmRegistryAdapter, npmRegistryPackageUrl } from "../../../src/sources/npm-registry";
import { SourceFetchClient, type FetchLike } from "../../../src/sources/fetch-client";
import { planBunDependency } from "../../../src/tools/plan-bun-dependency";

const tempDirs: string[] = [];

function packageMetadata(name: string, extras: Record<string, unknown> = {}) {
  return {
    name,
    "dist-tags": { latest: "1.0.0" },
    versions: {
      "1.0.0": {
        name,
        version: "1.0.0",
        ...extras
      }
    },
    time: { "1.0.0": "2026-01-01T00:00:00.000Z" }
  };
}

function tempProject(kind: "bun" | "npm" = "bun"): string {
  const dir = mkdtempSync(resolve(tmpdir(), "bun-dev-intel-plan-tool-"));
  tempDirs.push(dir);
  writeFileSync(resolve(dir, "package.json"), JSON.stringify({ type: "module" }));
  writeFileSync(resolve(dir, kind === "bun" ? "bun.lock" : "package-lock.json"), "");
  return dir;
}

function createAdapter(fetchImpl: FetchLike): NpmRegistryAdapter {
  const dir = mkdtempSync(resolve(tmpdir(), "bun-dev-intel-plan-registry-"));
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

describe("plan_bun_dependency tool", () => {
  test("runtime dependency produces bun add", async () => {
    const result = await planBunDependency(
      { projectPath: tempProject(), packages: [{ name: "zod" }], dependencyType: "dependencies" },
      { registryAdapter: createAdapter(registryFetch({ zod: packageMetadata("zod") })) }
    );

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.installCommand).toBe("bun add zod");
    }
  });

  test("dev dependency produces bun add -d", async () => {
    const result = await planBunDependency(
      { projectPath: tempProject(), packages: [{ name: "typescript" }], dependencyType: "devDependencies" },
      { registryAdapter: createAdapter(registryFetch({ typescript: packageMetadata("typescript") })) }
    );

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.installCommand).toBe("bun add -d typescript");
    }
  });

  test("multiple packages produce a single coherent command", async () => {
    const result = await planBunDependency(
      { projectPath: tempProject(), packages: [{ name: "zod" }, { name: "hono" }], dependencyType: "dependencies" },
      { registryAdapter: createAdapter(registryFetch({ zod: packageMetadata("zod"), hono: packageMetadata("hono") })) }
    );

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.installCommand).toBe("bun add zod hono");
    }
  });

  test("deprecated package returns warning", async () => {
    const result = await planBunDependency(
      { projectPath: tempProject(), packages: [{ name: "old-lib" }], dependencyType: "dependencies" },
      {
        registryAdapter: createAdapter(
          registryFetch({ "old-lib": packageMetadata("old-lib", { deprecated: "Use new-lib" }) })
        )
      }
    );

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.deprecationWarnings).toHaveLength(1);
    }
  });

  test("peer conflict returns warning", async () => {
    const result = await planBunDependency(
      { projectPath: tempProject(), packages: [{ name: "react-addon" }], dependencyType: "dependencies" },
      {
        registryAdapter: createAdapter(
          registryFetch({ "react-addon": packageMetadata("react-addon", { peerDependencies: { react: "^18" } }) })
        )
      }
    );

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.peerDependencyWarnings).toHaveLength(1);
    }
  });

  test("missing package returns structured error", async () => {
    const result = await planBunDependency(
      { projectPath: tempProject(), packages: [{ name: "missing-package" }], dependencyType: "dependencies" },
      { registryAdapter: createAdapter(registryFetch({})) }
    );

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe("fetch_failed");
    }
  });

  test("non-Bun project context lowers confidence or warns", async () => {
    const result = await planBunDependency(
      { projectPath: tempProject("npm"), packages: [{ name: "zod" }], dependencyType: "dependencies" },
      { registryAdapter: createAdapter(registryFetch({ zod: packageMetadata("zod") })) }
    );

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.confidence).toBe("medium");
      expect(result.warnings[0]?.id).toBe("dependency-plan-non-bun-project");
    }
  });
});
