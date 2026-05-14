import { describe, expect, test } from "bun:test";
import {
  BUN_DOCS_PRIMARY_INDEX_URL,
  BunDocsDiscoveryClient,
  type DocsSourceFetchLike
} from "../../../../src/docs/sources/bun-docs-discovery";

const fetchedAt = "2026-05-14T12:00:00.000Z";

function response(body: string, init: ResponseInit & { url?: string } = {}): Response {
  const result = new Response(body, init);

  if (init.url !== undefined) {
    Object.defineProperty(result, "url", { value: init.url });
  }

  return result;
}

describe("Bun docs discovery", () => {
  test("mocked llms.txt discovers expected pages", async () => {
    const fetchImpl: DocsSourceFetchLike = async () =>
      response(
        [
          "# Bun Docs",
          "- [HTTP server](https://bun.com/docs/runtime/http/server)",
          "- [Workspaces](https://bun.com/docs/pm/workspaces)"
        ].join("\n"),
        { status: 200, url: BUN_DOCS_PRIMARY_INDEX_URL }
      );
    const client = new BunDocsDiscoveryClient({ fetchImpl, now: () => fetchedAt });

    const result = await client.discoverPages();

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.pages).toEqual([
        {
          sourceId: "bun",
          title: "HTTP server",
          url: "https://bun.com/docs/runtime/http/server",
          canonicalUrl: "https://bun.com/docs/runtime/http/server"
        },
        {
          sourceId: "bun",
          title: "Workspaces",
          url: "https://bun.com/docs/pm/workspaces",
          canonicalUrl: "https://bun.com/docs/pm/workspaces"
        }
      ]);
      expect(result.fetchedAt).toBe(fetchedAt);
      expect(result.httpStatus).toBe(200);
      expect(result.warnings).toEqual([]);
      expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/u);
    }
  });

  test("disallowed URL in index is ignored with warning", async () => {
    const fetchImpl: DocsSourceFetchLike = async () =>
      response(
        [
          "- [HTTP server](https://bun.com/docs/runtime/http/server)",
          "- [Outside](https://example.com/docs/runtime/http/server)"
        ].join("\n"),
        { status: 200, url: BUN_DOCS_PRIMARY_INDEX_URL }
      );
    const client = new BunDocsDiscoveryClient({ fetchImpl, now: () => fetchedAt });

    const result = await client.discoverPages();

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.pages).toHaveLength(1);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]?.id).toBe("disallowed_docs_url");
    }
  });

  test("mocked page fetch returns normalized page metadata", async () => {
    const fetchImpl: DocsSourceFetchLike = async () =>
      response(
        "<main><h1>HTTP server</h1><p>Use <code>Bun.serve</code>.</p></main>",
        {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
          url: "https://bun.com/docs/runtime/http/server"
        }
      );
    const client = new BunDocsDiscoveryClient({ fetchImpl, now: () => fetchedAt });

    const result = await client.fetchPage("https://bun.com/docs/runtime/http/server");

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result).toMatchObject({
        sourceId: "bun",
        url: "https://bun.com/docs/runtime/http/server",
        canonicalUrl: "https://bun.com/docs/runtime/http/server",
        title: "HTTP server",
        fetchedAt,
        httpStatus: 200
      });
      expect(result.content).toContain("Use `Bun.serve`.");
      expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/u);
    }
  });

  test("network failure returns structured error", async () => {
    const client = new BunDocsDiscoveryClient({
      fetchImpl: async () => {
        throw new Error("network unavailable");
      },
      now: () => fetchedAt
    });

    const result = await client.discoverPages();

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe("fetch_failed");
      expect(result.error.details?.sourceUrl).toBe(BUN_DOCS_PRIMARY_INDEX_URL);
    }
  });

  test("redirect to disallowed host is rejected", async () => {
    const fetchImpl: DocsSourceFetchLike = async () =>
      response("<main><h1>Redirected</h1></main>", { status: 200, url: "https://example.com/docs/runtime/http/server" });
    const client = new BunDocsDiscoveryClient({ fetchImpl, now: () => fetchedAt });

    const result = await client.fetchPage("https://bun.com/docs/runtime/http/server");

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe("disallowed_source");
    }
  });
});
