import { describe, expect, test } from "bun:test";
import { checkSourceUrl } from "../../../src/sources/allowlist";

describe("source allowlist", () => {
  test("allows Bun docs URLs", () => {
    const result = checkSourceUrl("https://bun.com/docs/llms.txt");

    expect(result.allowed).toBe(true);

    if (result.allowed) {
      expect(result.sourceType).toBe("bun-docs");
      expect(result.url.href).toBe("https://bun.com/docs/llms.txt");
    }
  });

  test("allows npm registry package URLs", () => {
    expect(checkSourceUrl("https://registry.npmjs.org/zod").allowed).toBe(true);
    expect(checkSourceUrl("https://registry.npmjs.org/@modelcontextprotocol%2Fserver").allowed).toBe(true);
  });

  test("allows MCP docs and TypeScript SDK URLs", () => {
    expect(checkSourceUrl("https://modelcontextprotocol.io/docs/learn/server-concepts").allowed).toBe(true);
    expect(checkSourceUrl("https://github.com/modelcontextprotocol/typescript-sdk").allowed).toBe(true);
  });

  test("allows TypeScript docs URLs", () => {
    expect(checkSourceUrl("https://www.typescriptlang.org/docs/").allowed).toBe(true);
    expect(checkSourceUrl("https://www.typescriptlang.org/tsconfig/moduleResolution.html").allowed).toBe(true);
  });

  test("rejects arbitrary domains", () => {
    const result = checkSourceUrl("https://example.com/bun");

    expect(result.allowed).toBe(false);

    if (!result.allowed) {
      expect(result.error.code).toBe("disallowed_source");
    }
  });

  test("rejects misleading hostnames", () => {
    expect(checkSourceUrl("https://bun.com.evil.test/docs/llms.txt").allowed).toBe(false);
    expect(checkSourceUrl("https://evilbun.com/docs/llms.txt").allowed).toBe(false);
    expect(checkSourceUrl("https://bun.com@evil.test/docs/llms.txt").allowed).toBe(false);
    expect(checkSourceUrl("https://registry.npmjs.org.evil.test/zod").allowed).toBe(false);
  });

  test("rejects non-HTTPS external URLs", () => {
    expect(checkSourceUrl("http://bun.com/docs/llms.txt").allowed).toBe(false);
    expect(checkSourceUrl("http://registry.npmjs.org/zod").allowed).toBe(false);
  });

  test("allows non-HTTPS localhost only for local test mocks", () => {
    expect(checkSourceUrl("http://localhost:4010/mock", { allowLocalTestUrls: true }).allowed).toBe(true);
    expect(checkSourceUrl("http://127.0.0.1:4010/mock", { allowLocalTestUrls: true }).allowed).toBe(true);
    expect(checkSourceUrl("http://localhost:4010/mock").allowed).toBe(false);
  });

  test("rejects encoded path tricks outside npm scoped package metadata", () => {
    expect(checkSourceUrl("https://bun.com/docs/%2e%2e/secrets").allowed).toBe(false);
    expect(checkSourceUrl("https://modelcontextprotocol.io/docs/%2f%2fevil.test").allowed).toBe(false);
    expect(checkSourceUrl("https://registry.npmjs.org/%40scope%2Fpackage").allowed).toBe(true);
  });
});
