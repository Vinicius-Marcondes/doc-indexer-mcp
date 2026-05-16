import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const rootDir = resolve(import.meta.dir, "../..");

function read(path: string): string {
  return readFileSync(resolve(rootDir, path), "utf8");
}

describe("docs worker import boundary", () => {
  test("worker entrypoint consumes shared db and docs-domain package APIs", () => {
    const worker = read("apps/docs-worker/src/index.ts");

    expect(worker).toContain("@bun-dev-intel/db");
    expect(worker).toContain("@bun-dev-intel/docs-domain");
    expect(worker).not.toContain("./docs/storage/");
    expect(worker).not.toContain("./docs/ingestion/");
    expect(worker).not.toContain("./docs/refresh/");
    expect(worker).not.toContain("./docs/sources/");
    expect(worker).not.toContain("./docs/embeddings/");
  });

  test("worker entrypoint stays isolated from admin and MCP HTTP transport", () => {
    const worker = read("apps/docs-worker/src/index.ts");

    expect(worker).not.toContain("apps/admin-console");
    expect(worker).not.toContain("./http");
    expect(worker).not.toContain("../http");
    expect(worker).not.toContain("createRemoteDocsMcpServer");
    expect(worker).not.toContain("createRemoteDocsMcpHandler");
  });
});
