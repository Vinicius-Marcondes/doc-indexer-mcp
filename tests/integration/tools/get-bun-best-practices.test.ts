import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SqliteCacheStore } from "../../../src/cache/sqlite-cache";
import { BunDocsSearchAdapter } from "../../../src/sources/bun-docs-search";
import { SourceFetchClient, type FetchLike } from "../../../src/sources/fetch-client";
import { getBunBestPractices } from "../../../src/tools/get-bun-best-practices";

const testDir = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(testDir, "../../fixtures/projects");
const tempDirs: string[] = [];

const docs = `# TypeScript
URL: https://bun.com/docs/runtime/typescript
Install @types/bun, use types ["bun"], moduleResolution bundler, module Preserve, target ESNext, and noEmit true.

# Lockfile
URL: https://bun.com/docs/pm/lockfile
Bun uses bun.lock as the current text lockfile. Legacy bun.lockb should be migrated.

# Test Runner
URL: https://bun.com/docs/test
Use bun test with imports from bun:test.
`;

function createStore(): SqliteCacheStore {
  const dir = mkdtempSync(resolve(tmpdir(), "bun-dev-intel-best-practices-"));
  tempDirs.push(dir);
  return new SqliteCacheStore(resolve(dir, "cache.sqlite"));
}

function createAdapter(fetchImpl: FetchLike): BunDocsSearchAdapter {
  return new BunDocsSearchAdapter({
    cache: createStore(),
    fetchClient: new SourceFetchClient({
      fetchImpl,
      now: () => "2026-05-12T10:00:00.000Z"
    }),
    now: () => "2026-05-12T10:00:00.000Z"
  });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("get_bun_best_practices tool", () => {
  test("TypeScript topic returns Bun types and compiler option guidance", async () => {
    const result = await getBunBestPractices(
      { topic: "typescript" },
      { docsAdapter: createAdapter(async () => new Response(docs, { status: 200 })) }
    );

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.recommendations.map((item) => item.id)).toEqual([
        "best-practice-typescript-bun-types",
        "best-practice-typescript-compiler-options"
      ]);
      expect(result.sources[0]?.url).toBe("https://bun.com/docs/runtime/typescript");
    }
  });

  test("lockfile topic returns bun.lock guidance", async () => {
    const result = await getBunBestPractices(
      { topic: "lockfile" },
      { docsAdapter: createAdapter(async () => new Response(docs, { status: 200 })) }
    );

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.recommendations[0]?.id).toBe("best-practice-lockfile-bun-lock");
    }
  });

  test("tests topic returns bun:test guidance", async () => {
    const result = await getBunBestPractices(
      { topic: "tests" },
      { docsAdapter: createAdapter(async () => new Response(docs, { status: 200 })) }
    );

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.recommendations[0]?.id).toBe("best-practice-tests-bun-test");
    }
  });

  test("project-tailored response includes project fit", async () => {
    const result = await getBunBestPractices(
      { topic: "typescript", projectPath: resolve(fixturesDir, "missing-bun-types") },
      { docsAdapter: createAdapter(async () => new Response(docs, { status: 200 })) }
    );

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.projectFit).toEqual({
        projectPath: resolve(fixturesDir, "missing-bun-types"),
        packageManager: "unknown",
        recommendationIds: expect.arrayContaining(["missing-types-bun-package", "missing-tsconfig-bun-types"])
      });
    }
  });

  test("unknown topic fails validation", async () => {
    const result = await getBunBestPractices(
      { topic: "unknown-topic" },
      { docsAdapter: createAdapter(async () => new Response(docs, { status: 200 })) }
    );

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe("invalid_input");
    }
  });
});
