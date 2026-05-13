import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { SqliteCacheStore } from "../../../src/cache/sqlite-cache";
import { validateAgentResponseEnvelope } from "../../../src/shared/agent-output";
import { NpmRegistryAdapter, npmRegistryPackageUrl } from "../../../src/sources/npm-registry";
import { SourceFetchClient, type FetchLike } from "../../../src/sources/fetch-client";
import { checkBeforeInstall } from "../../../src/tools/check-before-install";

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
  const dir = mkdtempSync(resolve(tmpdir(), "bun-dev-intel-check-install-"));
  tempDirs.push(dir);
  writeFileSync(resolve(dir, "package.json"), JSON.stringify({ type: "module" }));
  writeFileSync(resolve(dir, kind === "bun" ? "bun.lock" : "package-lock.json"), "");
  return dir;
}

function createAdapter(fetchImpl: FetchLike): NpmRegistryAdapter {
  const dir = mkdtempSync(resolve(tmpdir(), "bun-dev-intel-check-install-registry-"));
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

function validateEnvelopePortion(result: Extract<Awaited<ReturnType<typeof checkBeforeInstall>>, { ok: true }>): void {
  const { packageManager: _packageManager, packages: _packages, ...envelope } = result;
  validateAgentResponseEnvelope(envelope);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("check_before_install tool", () => {
  test("runtime dependency returns a bun add command action", async () => {
    const result = await checkBeforeInstall(
      { projectPath: tempProject(), packages: [{ name: "zod" }], dependencyType: "dependencies" },
      { registryAdapter: createAdapter(registryFetch({ zod: packageMetadata("zod") })) }
    );

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.actions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: "command", command: "bun add zod", requiresApproval: true })
        ])
      );
      validateEnvelopePortion(result);
    }
  });

  test("dev dependency returns a bun add -d command action", async () => {
    const result = await checkBeforeInstall(
      { projectPath: tempProject(), packages: [{ name: "typescript" }], dependencyType: "devDependencies" },
      { registryAdapter: createAdapter(registryFetch({ typescript: packageMetadata("typescript") })) }
    );

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.actions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: "command", command: "bun add -d typescript", requiresApproval: true })
        ])
      );
    }
  });

  test("deprecated package returns a warning finding", async () => {
    const result = await checkBeforeInstall(
      { projectPath: tempProject(), packages: [{ name: "old-lib" }], dependencyType: "dependencies" },
      {
        registryAdapter: createAdapter(
          registryFetch({ "old-lib": packageMetadata("old-lib", { deprecated: "Use new-lib" }) })
        )
      }
    );

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.findings.map((finding) => finding.id)).toContain("dependency-deprecated-old-lib-1.0.0");
      expect(result.findings.find((finding) => finding.id === "dependency-deprecated-old-lib-1.0.0")?.change).toMatchObject({
        sinceDate: "2026-01-01",
        evidence: "npm-publish-time"
      });
    }
  });

  test("peer dependency metadata returns a warning finding", async () => {
    const result = await checkBeforeInstall(
      { projectPath: tempProject(), packages: [{ name: "react-addon" }], dependencyType: "dependencies" },
      {
        registryAdapter: createAdapter(
          registryFetch({ "react-addon": packageMetadata("react-addon", { peerDependencies: { react: "^18" } }) })
        )
      }
    );

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.findings.map((finding) => finding.id)).toContain("dependency-peer-review-react-addon-1.0.0");
    }
  });

  test("engine metadata returns a review finding", async () => {
    const result = await checkBeforeInstall(
      { projectPath: tempProject(), packages: [{ name: "runtime-lib" }], dependencyType: "dependencies" },
      {
        registryAdapter: createAdapter(
          registryFetch({ "runtime-lib": packageMetadata("runtime-lib", { engines: { bun: ">=1.3.0" } }) })
        )
      }
    );

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.findings.map((finding) => finding.id)).toContain("dependency-engine-review-runtime-lib-1.0.0");
    }
  });

  test("non-Bun project context lowers confidence or warns", async () => {
    const result = await checkBeforeInstall(
      { projectPath: tempProject("npm"), packages: [{ name: "zod" }], dependencyType: "dependencies" },
      { registryAdapter: createAdapter(registryFetch({ zod: packageMetadata("zod") })) }
    );

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.confidence).toBe("medium");
      expect(result.warnings.map((warning) => warning.id)).toContain("dependency-plan-non-bun-project");
    }
  });

  test("brief output stays within budget", async () => {
    const result = await checkBeforeInstall(
      { projectPath: tempProject(), packages: [{ name: "zod" }], dependencyType: "dependencies" },
      { registryAdapter: createAdapter(registryFetch({ zod: packageMetadata("zod") })) }
    );

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.responseMode).toBe("brief");
      expect(result.summary.length).toBeLessThanOrEqual(500);
      expect(result.findings.length).toBeLessThanOrEqual(2);
      expect(result.actions.length).toBeLessThanOrEqual(2);
    }
  });
});
