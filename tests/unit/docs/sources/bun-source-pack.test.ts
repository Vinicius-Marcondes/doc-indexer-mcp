import { describe, expect, test } from "bun:test";
import {
  bunDocsSourcePack,
  createDocsSourceRegistry,
  revalidateSourceRedirect
} from "../../../../src/docs/sources/bun-source-pack";

describe("Bun docs source pack", () => {
  test("has stable source metadata", () => {
    expect(bunDocsSourcePack.sourceId).toBe("bun");
    expect(bunDocsSourcePack.displayName).toBe("Bun Documentation");
    expect(bunDocsSourcePack.enabled).toBe(true);
    expect(bunDocsSourcePack.allowedHosts).toEqual(["bun.com"]);
    expect(bunDocsSourcePack.indexUrls).toEqual([
      "https://bun.com/docs/llms.txt",
      "https://bun.com/docs/llms-full.txt"
    ]);
  });

  test("allows official index URLs", () => {
    for (const url of bunDocsSourcePack.indexUrls) {
      const result = bunDocsSourcePack.checkUrl(url);

      expect(result.allowed).toBe(true);

      if (result.allowed) {
        expect(result.sourceId).toBe("bun");
        expect(result.url.href).toBe(url);
        expect(result.urlKind).toBe("index");
      }
    }
  });

  test("allows official docs pages", () => {
    const result = bunDocsSourcePack.checkUrl("https://bun.com/docs/runtime/http/server");

    expect(result.allowed).toBe(true);

    if (result.allowed) {
      expect(result.sourceId).toBe("bun");
      expect(result.url.href).toBe("https://bun.com/docs/runtime/http/server");
      expect(result.urlKind).toBe("page");
    }
  });

  test("rejects non-HTTPS Bun URLs", () => {
    expect(bunDocsSourcePack.checkUrl("http://bun.com/docs/llms.txt").allowed).toBe(false);
  });

  test("rejects hostname tricks", () => {
    expect(bunDocsSourcePack.checkUrl("https://bun.com.evil.test/docs/llms.txt").allowed).toBe(false);
    expect(bunDocsSourcePack.checkUrl("https://bun.com@evil.test/docs/llms.txt").allowed).toBe(false);
  });

  test("rejects encoded path traversal", () => {
    expect(bunDocsSourcePack.checkUrl("https://bun.com/docs/%2e%2e/secrets").allowed).toBe(false);
    expect(bunDocsSourcePack.checkUrl("https://bun.com/docs/%2f%2fevil.test").allowed).toBe(false);
  });

  test("revalidates redirect targets", () => {
    expect(
      revalidateSourceRedirect(bunDocsSourcePack, "https://bun.com/docs/runtime/http/server", "/docs/runtime/fetch")
        .allowed
    ).toBe(true);
    expect(
      revalidateSourceRedirect(
        bunDocsSourcePack,
        "https://bun.com/docs/runtime/http/server",
        "https://example.com/docs/runtime/fetch"
      ).allowed
    ).toBe(false);
  });

  test("unknown source ID fails source registry lookup", () => {
    const registry = createDocsSourceRegistry([bunDocsSourcePack]);

    expect(registry.get("bun")).toBe(bunDocsSourcePack);
    expect(() => registry.require("typescript")).toThrow("Unknown docs source pack: typescript");
  });
});
