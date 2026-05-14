import { describe, expect, test } from "bun:test";
import { bunDocsSourcePack } from "../../../../src/docs/sources/bun-source-pack";
import { chunkDocsPage } from "../../../../src/docs/ingestion/chunking";

const baseInput = {
  sourceId: "bun",
  pageId: "page-runtime",
  title: "Runtime",
  url: "https://bun.com/docs/runtime/http/server"
} as const;

describe("docs chunking", () => {
  test("splits long docs into bounded chunks", () => {
    const content = [
      "# Runtime",
      "",
      ...Array.from(
        { length: 8 },
        (_, index) =>
          `Paragraph ${index} explains Bun.serve request handling with stable context and enough words for chunking.`
      )
    ].join("\n\n");

    const result = chunkDocsPage({
      ...baseInput,
      content,
      chunking: { targetTokens: 35, overlapTokens: 0 }
    });

    expect(result.chunks.length).toBeGreaterThan(1);
    expect(result.pageContentHash).toMatch(/^[a-f0-9]{64}$/u);

    for (const chunk of result.chunks) {
      expect(chunk.tokenEstimate).toBeLessThanOrEqual(35);
      expect(chunk.content).not.toBe("");
      expect(chunk.contentHash).toMatch(/^[a-f0-9]{64}$/u);
    }
  });

  test("preserves heading paths", () => {
    const result = chunkDocsPage({
      ...baseInput,
      content: [
        "# Runtime",
        "",
        "Top-level runtime overview.",
        "",
        "## HTTP server",
        "",
        "Use Bun.serve to start a server.",
        "",
        "### WebSocket",
        "",
        "Upgrade requests inside the fetch handler."
      ].join("\n"),
      chunking: { targetTokens: 80, overlapTokens: 0 }
    });
    const serverChunk = result.chunks.find((chunk) => chunk.content.includes("Bun.serve"));
    const socketChunk = result.chunks.find((chunk) => chunk.content.includes("Upgrade requests"));

    expect(serverChunk?.headingPath).toEqual(["Runtime", "HTTP server"]);
    expect(socketChunk?.headingPath).toEqual(["Runtime", "HTTP server", "WebSocket"]);
  });

  test("does not emit sparse heading paths when heading levels are skipped", () => {
    const result = chunkDocsPage({
      ...baseInput,
      content: [
        "### Skipped parent levels",
        "",
        "This page starts below h1 and h2, but the heading path must still be dense."
      ].join("\n"),
      chunking: { targetTokens: 80, overlapTokens: 0 }
    });

    expect(result.chunks[0]?.headingPath).toEqual(["Skipped parent levels"]);
    expect(result.chunks.flatMap((chunk) => chunk.headingPath)).not.toContain(undefined);
  });

  test("preserves code blocks and API identifiers", () => {
    const result = chunkDocsPage({
      ...baseInput,
      content: [
        "# Runtime",
        "",
        "Use Bun.serve with bun:test coverage and commit bun.lock.",
        "",
        "```ts",
        "import { test } from \"bun:test\";",
        "Bun.serve({ fetch() { return new Response(\"ok\"); } });",
        "```"
      ].join("\n"),
      chunking: bunDocsSourcePack.chunking
    });
    const content = result.chunks.map((chunk) => chunk.content).join("\n\n");

    expect(content).toContain("```ts");
    expect(content).toContain("Bun.serve");
    expect(content).toContain("bun:test");
    expect(content).toContain("bun.lock");
  });

  test("generates stable page and chunk hashes", () => {
    const input = {
      ...baseInput,
      content: "# Runtime\n\nUse Bun.serve for HTTP servers.",
      chunking: { targetTokens: 80, overlapTokens: 0 }
    };
    const first = chunkDocsPage(input);
    const second = chunkDocsPage(input);

    expect(second.pageContentHash).toBe(first.pageContentHash);
    expect(second.chunks.map((chunk) => chunk.contentHash)).toEqual(first.chunks.map((chunk) => chunk.contentHash));
  });

  test("different content changes relevant hashes", () => {
    const first = chunkDocsPage({
      ...baseInput,
      content: "# Runtime\n\nUse Bun.serve for HTTP servers.",
      chunking: { targetTokens: 80, overlapTokens: 0 }
    });
    const second = chunkDocsPage({
      ...baseInput,
      content: "# Runtime\n\nUse Bun.serve for WebSocket servers.",
      chunking: { targetTokens: 80, overlapTokens: 0 }
    });

    expect(second.pageContentHash).not.toBe(first.pageContentHash);
    expect(second.chunks.map((chunk) => chunk.contentHash)).not.toEqual(
      first.chunks.map((chunk) => chunk.contentHash)
    );
  });

  test("tiny pages still produce one valid chunk", () => {
    const result = chunkDocsPage({
      ...baseInput,
      content: "# Runtime\n\nSmall page.",
      chunking: { targetTokens: 80, overlapTokens: 0 }
    });

    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0]).toMatchObject({
      chunkIndex: 0,
      headingPath: ["Runtime"],
      title: "Runtime",
      url: baseInput.url
    });
  });

  test("chunk order is stable", () => {
    const result = chunkDocsPage({
      ...baseInput,
      content: "# Runtime\n\nFirst paragraph.\n\nSecond paragraph.\n\nThird paragraph.",
      chunking: { targetTokens: 8, overlapTokens: 0 }
    });

    expect(result.chunks.map((chunk) => chunk.chunkIndex)).toEqual([0, 1, 2]);
    expect(result.chunks.map((chunk) => chunk.content)).toEqual([
      "# Runtime\n\nFirst paragraph.",
      "Second paragraph.",
      "Third paragraph."
    ]);
  });
});
