import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { FindingCacheStore } from "../../../src/cache/finding-cache";
import type { AgentFinding } from "../../../src/shared/agent-output";

const tempDirs: string[] = [];
const generatedAt = "2026-05-12T10:00:00.000Z";

function tempCache(): FindingCacheStore {
  const dir = mkdtempSync(resolve(tmpdir(), "bun-dev-intel-finding-cache-"));
  tempDirs.push(dir);
  return new FindingCacheStore(resolve(dir, "cache.sqlite"));
}

function finding(overrides: Partial<AgentFinding> = {}): AgentFinding {
  return {
    id: "missing-types-bun-package",
    ruleId: "missing-types-bun-package",
    framework: "bun",
    severity: "warning",
    title: "Add @types/bun",
    message: "Bun globals need Bun types.",
    evidence: ["Detected Bun.serve at src/index.ts:1"],
    locations: [{ filePath: "src/index.ts", line: 1 }],
    citationIds: ["c1"],
    fingerprint: "fp-missing-types",
    ...overrides
  };
}

function writeFixture(cache: FindingCacheStore, overrides: Partial<Parameters<FindingCacheStore["setFinding"]>[0]> = {}) {
  return cache.setFinding({
    projectHash: "project-hash",
    scope: "file",
    relativePath: "src/index.ts",
    fileHash: "file-hash-1",
    ruleId: "missing-types-bun-package",
    fingerprint: "fp-missing-types",
    finding: finding(),
    sourceContentHashes: { c1: "source-hash-1" },
    generatedAt,
    schemaVersion: "agent-output-v1",
    ...overrides
  });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("finding cache", () => {
  test("stores and retrieves a finding by project hash and fingerprint", () => {
    const cache = tempCache();
    writeFixture(cache);

    const cached = cache.getFinding({
      projectHash: "project-hash",
      fingerprint: "fp-missing-types",
      fileHash: "file-hash-1",
      sourceContentHashes: { c1: "source-hash-1" },
      schemaVersion: "agent-output-v1"
    });

    expect(cached?.finding).toEqual(finding());
    cache.close();
  });

  test("reuses unchanged file/rule findings", () => {
    const cache = tempCache();
    writeFixture(cache);

    const cached = cache.reuseFinding({
      projectHash: "project-hash",
      scope: "file",
      relativePath: "src/index.ts",
      ruleId: "missing-types-bun-package",
      fileHash: "file-hash-1",
      sourceContentHashes: { c1: "source-hash-1" },
      schemaVersion: "agent-output-v1"
    });

    expect(cached?.fingerprint).toBe("fp-missing-types");
    cache.close();
  });

  test("invalidates when file hash changes", () => {
    const cache = tempCache();
    writeFixture(cache);

    expect(
      cache.reuseFinding({
        projectHash: "project-hash",
        scope: "file",
        relativePath: "src/index.ts",
        ruleId: "missing-types-bun-package",
        fileHash: "file-hash-2",
        sourceContentHashes: { c1: "source-hash-1" },
        schemaVersion: "agent-output-v1"
      })
    ).toBeNull();
    cache.close();
  });

  test("invalidates when schema version changes", () => {
    const cache = tempCache();
    writeFixture(cache);

    expect(
      cache.getFinding({
        projectHash: "project-hash",
        fingerprint: "fp-missing-types",
        fileHash: "file-hash-1",
        sourceContentHashes: { c1: "source-hash-1" },
        schemaVersion: "agent-output-v2"
      })
    ).toBeNull();
    cache.close();
  });

  test("invalidates source-backed finding when source content hash changes", () => {
    const cache = tempCache();
    writeFixture(cache);

    expect(
      cache.reuseFinding({
        projectHash: "project-hash",
        scope: "file",
        relativePath: "src/index.ts",
        ruleId: "missing-types-bun-package",
        fileHash: "file-hash-1",
        sourceContentHashes: { c1: "source-hash-2" },
        schemaVersion: "agent-output-v1"
      })
    ).toBeNull();
    cache.close();
  });
});
