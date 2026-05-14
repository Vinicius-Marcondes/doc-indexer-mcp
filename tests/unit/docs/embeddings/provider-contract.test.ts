import { describe, expect, test } from "bun:test";
import { FakeEmbeddingProvider } from "../../../../src/docs/embeddings/fake-provider";
import { createEmbeddingProviderFailure, validateEmbeddingDimensions } from "../../../../src/docs/embeddings/provider";

describe("embedding provider contract", () => {
  test("fake provider returns configured dimensions", async () => {
    const provider = new FakeEmbeddingProvider({ dimensions: 8 });
    const result = await provider.embedTexts({ texts: ["Bun.serve docs"] });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.metadata.dimensions).toBe(8);
      expect(result.embeddings[0]?.vector).toHaveLength(8);
    }
  });

  test("same text returns same vector", async () => {
    const provider = new FakeEmbeddingProvider({ dimensions: 12 });
    const first = await provider.embedTexts({ texts: ["same text"] });
    const second = await provider.embedTexts({ texts: ["same text"] });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);

    if (first.ok && second.ok) {
      expect(second.embeddings[0]?.vector).toEqual(first.embeddings[0]?.vector);
    }
  });

  test("different text returns distinguishable vector", async () => {
    const provider = new FakeEmbeddingProvider({ dimensions: 12 });
    const result = await provider.embedTexts({ texts: ["Bun.serve", "bun:test"] });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.embeddings[0]?.vector).not.toEqual(result.embeddings[1]?.vector);
    }
  });

  test("batch order is preserved", async () => {
    const provider = new FakeEmbeddingProvider({ dimensions: 4 });
    const texts = ["first", "second", "third"];
    const result = await provider.embedTexts({ texts });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.embeddings.map((embedding) => embedding.index)).toEqual([0, 1, 2]);
      expect(result.embeddings.map((embedding) => embedding.text)).toEqual(texts);
    }
  });

  test("dimension mismatch helper rejects invalid vectors", () => {
    const tooShort = validateEmbeddingDimensions([0.1, 0.2], 3);
    const notFinite = validateEmbeddingDimensions([0.1, Number.NaN, 0.3], 3);

    expect(tooShort.ok).toBe(false);
    expect(notFinite.ok).toBe(false);

    if (!tooShort.ok && !notFinite.ok) {
      expect(tooShort.error.code).toBe("invalid_input");
      expect(notFinite.error.details?.reason).toBe("Embedding vector contains a non-finite value.");
    }
  });

  test("provider metadata includes version, model, and provider", async () => {
    const provider = new FakeEmbeddingProvider({
      provider: "fake",
      model: "fake-small",
      dimensions: 6,
      embeddingVersion: "fake-small:v2"
    });
    const result = await provider.embedTexts({ texts: ["metadata"] });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.metadata).toEqual({
        provider: "fake",
        model: "fake-small",
        dimensions: 6,
        embeddingVersion: "fake-small:v2"
      });
    }
  });

  test("provider failure shape is structured", async () => {
    const provider = new FakeEmbeddingProvider({
      failWith: createEmbeddingProviderFailure("fake", "rate limited")
    });
    const result = await provider.embedTexts({ texts: ["will fail"] });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe("fetch_failed");
      expect(result.error.details?.provider).toBe("fake");
    }
  });
});
