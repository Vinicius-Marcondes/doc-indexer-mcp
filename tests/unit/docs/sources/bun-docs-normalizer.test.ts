import { describe, expect, test } from "bun:test";
import { normalizeBunDocsContent } from "../../../../src/docs/sources/bun-docs-normalizer";

describe("Bun docs normalizer", () => {
  test("markdown content normalizes consistently", () => {
    const normalized = normalizeBunDocsContent({
      url: "https://bun.com/docs/runtime/http/server",
      body: "# HTTP server\r\n\r\nUse `Bun.serve` to start a server.\r\n\r\n",
      contentType: "text/markdown"
    });

    expect(normalized.title).toBe("HTTP server");
    expect(normalized.content).toBe("# HTTP server\n\nUse `Bun.serve` to start a server.");
  });

  test("HTML content normalizes to clean markdown-like text", () => {
    const normalized = normalizeBunDocsContent({
      url: "https://bun.com/docs/runtime/http/server",
      body: `
        <html>
          <body>
            <nav>Docs Home Search</nav>
            <main>
              <h1>HTTP server</h1>
              <p>Use <code>Bun.serve</code> to start a server.</p>
              <pre><code>const server = Bun.serve({
  fetch() {
    return new Response("ok");
  }
});</code></pre>
            </main>
            <footer>Copyright</footer>
          </body>
        </html>
      `,
      contentType: "text/html"
    });

    expect(normalized.title).toBe("HTTP server");
    expect(normalized.content).toContain("# HTTP server");
    expect(normalized.content).toContain("Use `Bun.serve` to start a server.");
    expect(normalized.content).not.toContain("Docs Home Search");
    expect(normalized.content).not.toContain("Copyright");
  });

  test("code blocks are preserved enough for search", () => {
    const normalized = normalizeBunDocsContent({
      url: "https://bun.com/docs/runtime/http/server",
      body: "<main><h1>HTTP server</h1><pre><code>Bun.serve({ fetch(request) { return new Response(request.url); } });</code></pre></main>",
      contentType: "text/html"
    });

    expect(normalized.content).toContain("```");
    expect(normalized.content).toContain("Bun.serve({ fetch(request) { return new Response(request.url); } });");
  });

  test("heading text is preserved when title metadata is absent", () => {
    const normalized = normalizeBunDocsContent({
      url: "https://bun.com/docs/pm/workspaces",
      body: "<main><h2>Workspaces</h2><p>Use Bun workspaces for monorepos.</p></main>",
      contentType: "text/html"
    });

    expect(normalized.title).toBe("Workspaces");
    expect(normalized.content).toContain("## Workspaces");
  });
});
