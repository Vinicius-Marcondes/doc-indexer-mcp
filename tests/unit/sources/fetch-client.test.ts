import { describe, expect, test } from "bun:test";
import { SourceFetchClient, type FetchLike } from "../../../src/sources/fetch-client";
import { computeContentHash } from "../../../src/cache/sqlite-cache";

describe("source fetch client", () => {
  test("calls mocked fetch for allowed URLs", async () => {
    const calls: string[] = [];
    const fetchImpl: FetchLike = async (url) => {
      calls.push(String(url));
      return new Response("Bun docs", { status: 200 });
    };
    const client = new SourceFetchClient({
      fetchImpl,
      now: () => "2026-05-12T10:00:00.000Z"
    });

    const result = await client.fetchText("https://bun.com/docs/llms.txt");

    expect(calls).toEqual(["https://bun.com/docs/llms.txt"]);
    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.body).toBe("Bun docs");
      expect(result.status).toBe(200);
      expect(result.sourceType).toBe("bun-docs");
      expect(result.fetchedAt).toBe("2026-05-12T10:00:00.000Z");
    }
  });

  test("does not call fetch for disallowed URLs", async () => {
    let called = false;
    const client = new SourceFetchClient({
      fetchImpl: async () => {
        called = true;
        return new Response("bad", { status: 200 });
      }
    });

    const result = await client.fetchText("https://example.com/bun");

    expect(called).toBe(false);
    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe("disallowed_source");
    }
  });

  test("converts non-2xx responses into structured errors", async () => {
    const client = new SourceFetchClient({
      fetchImpl: async () => new Response("missing", { status: 404, statusText: "Not Found" })
    });

    const result = await client.fetchText("https://bun.com/docs/missing");

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe("fetch_failed");
      expect(result.error.details).toEqual({
        sourceUrl: "https://bun.com/docs/missing",
        status: 404,
        statusText: "Not Found"
      });
    }
  });

  test("handles timeout or abort", async () => {
    const fetchImpl: FetchLike = async (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    const client = new SourceFetchClient({
      fetchImpl,
      timeoutMs: 1
    });

    const result = await client.fetchText("https://bun.com/docs/llms.txt");

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe("fetch_failed");
      expect(result.error.message).toContain("timed out");
    }
  });

  test("returns metadata needed by the cache", async () => {
    const client = new SourceFetchClient({
      fetchImpl: async () => new Response("registry metadata\n", { status: 200 }),
      now: () => "2026-05-12T10:00:00.000Z"
    });

    const result = await client.fetchText("https://registry.npmjs.org/zod");

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.finalUrl).toBe("https://registry.npmjs.org/zod");
      expect(result.status).toBe(200);
      expect(result.fetchedAt).toBe("2026-05-12T10:00:00.000Z");
      expect(result.contentHash).toBe(computeContentHash("registry metadata\n"));
    }
  });
});
