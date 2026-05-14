import { describe, expect, test } from "bun:test";
import {
  OpenAiEmbeddingProvider,
  createOpenAiEmbeddingProviderFromConfig
} from "../../../../src/docs/embeddings/openai-provider";
import type { DocsSourceFetchLike } from "../../../../src/docs/sources/bun-docs-discovery";

interface CapturedRequest {
  readonly url: string;
  readonly method: string | undefined;
  readonly authorization: string | null;
  readonly body: unknown;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function headerValue(headers: RequestInit["headers"] | undefined, key: string): string | null {
  if (headers instanceof Headers) {
    return headers.get(key);
  }

  if (Array.isArray(headers)) {
    for (const entry of headers) {
      const name = entry[0];
      const value = entry[1];

      if (name !== undefined && name.toLowerCase() === key.toLowerCase()) {
        return value ?? null;
      }
    }

    return null;
  }

  const value = headers?.[key];
  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0] : null;
  }

  return typeof value === "string" ? value : null;
}

function createCapturingFetch(responseBody: unknown, captured: CapturedRequest[], status = 200): DocsSourceFetchLike {
  return async (url, init) => {
    captured.push({
      url,
      method: init?.method,
      authorization: headerValue(init?.headers, "authorization"),
      body: JSON.parse(String(init?.body))
    });
    return jsonResponse(responseBody, status);
  };
}

describe("OpenAI embedding provider", () => {
  test("sends expected request body to mocked fetch", async () => {
    const captured: CapturedRequest[] = [];
    const provider = new OpenAiEmbeddingProvider({
      apiKey: "sk-test-openai-key",
      model: "text-embedding-3-small",
      dimensions: 3,
      fetchImpl: createCapturingFetch(
        {
          object: "list",
          data: [{ object: "embedding", index: 0, embedding: [0.1, 0.2, 0.3] }],
          model: "text-embedding-3-small",
          usage: { prompt_tokens: 2, total_tokens: 2 }
        },
        captured
      )
    });

    const result = await provider.embedTexts({ texts: ["Bun.serve"] });

    expect(result.ok).toBe(true);
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      url: "https://api.openai.com/v1/embeddings",
      method: "POST",
      authorization: "Bearer sk-test-openai-key",
      body: {
        model: "text-embedding-3-small",
        input: ["Bun.serve"],
        encoding_format: "float",
        dimensions: 3
      }
    });
  });

  test("can target an OpenAI-compatible local embedding endpoint", async () => {
    const captured: CapturedRequest[] = [];
    const provider = new OpenAiEmbeddingProvider({
      apiKey: "local-placeholder-key",
      model: "text-embedding-3-small",
      baseUrl: "http://localhost:11434/v1",
      dimensions: 3,
      fetchImpl: createCapturingFetch(
        {
          object: "list",
          data: [{ object: "embedding", index: 0, embedding: [0.1, 0.2, 0.3] }],
          model: "text-embedding-3-small",
          usage: { prompt_tokens: 2, total_tokens: 2 }
        },
        captured
      )
    });

    const result = await provider.embedTexts({ texts: ["Bun.serve"] });

    expect(result.ok).toBe(true);
    expect(captured[0]?.url).toBe("http://localhost:11434/v1/embeddings");
    expect(captured[0]?.authorization).toBe("Bearer local-placeholder-key");
  });

  test("parses embedding response", async () => {
    const provider = new OpenAiEmbeddingProvider({
      apiKey: "sk-test-openai-key",
      model: "text-embedding-3-small",
      dimensions: 3,
      fetchImpl: createCapturingFetch(
        {
          object: "list",
          data: [
            { object: "embedding", index: 0, embedding: [0.1, 0.2, 0.3] },
            { object: "embedding", index: 1, embedding: [0.4, 0.5, 0.6] }
          ],
          model: "text-embedding-3-small",
          usage: { prompt_tokens: 4, total_tokens: 4 }
        },
        []
      )
    });

    const result = await provider.embedTexts({ texts: ["first", "second"] });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.metadata).toEqual({
        provider: "openai",
        model: "text-embedding-3-small",
        dimensions: 3,
        embeddingVersion: "text-embedding-3-small:3"
      });
      expect(result.embeddings.map((embedding) => embedding.vector)).toEqual([
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6]
      ]);
    }
  });

  test("preserves input order across batches", async () => {
    const responses = [
      {
        object: "list",
        data: [
          { object: "embedding", index: 1, embedding: [0.2, 0.2] },
          { object: "embedding", index: 0, embedding: [0.1, 0.1] }
        ],
        model: "text-embedding-3-small",
        usage: { prompt_tokens: 4, total_tokens: 4 }
      },
      {
        object: "list",
        data: [{ object: "embedding", index: 0, embedding: [0.3, 0.3] }],
        model: "text-embedding-3-small",
        usage: { prompt_tokens: 2, total_tokens: 2 }
      }
    ];
    const provider = new OpenAiEmbeddingProvider({
      apiKey: "sk-test-openai-key",
      model: "text-embedding-3-small",
      dimensions: 2,
      batchSize: 2,
      fetchImpl: async () => jsonResponse(responses.shift())
    });

    const result = await provider.embedTexts({ texts: ["first", "second", "third"] });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.embeddings.map((embedding) => embedding.index)).toEqual([0, 1, 2]);
      expect(result.embeddings.map((embedding) => embedding.text)).toEqual(["first", "second", "third"]);
      expect(result.embeddings.map((embedding) => embedding.vector)).toEqual([
        [0.1, 0.1],
        [0.2, 0.2],
        [0.3, 0.3]
      ]);
    }
  });

  test("handles rate-limit response with retryable structured error", async () => {
    const provider = new OpenAiEmbeddingProvider({
      apiKey: "sk-test-openai-key",
      model: "text-embedding-3-small",
      dimensions: 3,
      fetchImpl: async () => jsonResponse({ error: { message: "slow down" } }, 429)
    });

    const result = await provider.embedTexts({ texts: ["rate limited"] });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe("fetch_failed");
      expect(result.error.details).toMatchObject({ provider: "openai", status: 429, retryable: true });
    }
  });

  test("handles invalid response shape", async () => {
    const provider = new OpenAiEmbeddingProvider({
      apiKey: "sk-test-openai-key",
      model: "text-embedding-3-small",
      dimensions: 3,
      fetchImpl: async () => jsonResponse({ object: "list", data: [{ index: 0 }], model: "text-embedding-3-small" })
    });

    const result = await provider.embedTexts({ texts: ["bad response"] });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe("parse_failed");
    }
  });

  test("redacts API key from errors", async () => {
    const apiKey = "sk-secret-openai-key";
    const provider = new OpenAiEmbeddingProvider({
      apiKey,
      model: "text-embedding-3-small",
      dimensions: 3,
      fetchImpl: async () => jsonResponse({ error: { message: `bad key ${apiKey}` } }, 401)
    });

    const result = await provider.embedTexts({ texts: ["secret"] });

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(apiKey);
  });

  test("uses configured model from parsed config", async () => {
    const captured: CapturedRequest[] = [];
    const provider = createOpenAiEmbeddingProviderFromConfig(
      {
        provider: "openai",
        apiKey: "sk-test-openai-key",
        model: "text-embedding-3-large",
        baseUrl: "http://localhost:11434/v1"
      },
      {
        dimensions: 2,
        fetchImpl: createCapturingFetch(
          {
            object: "list",
            data: [{ object: "embedding", index: 0, embedding: [0.1, 0.2] }],
            model: "text-embedding-3-large",
            usage: { prompt_tokens: 1, total_tokens: 1 }
          },
          captured
        )
      }
    );

    const result = await provider.embedTexts({ texts: ["configured"] });

    expect(result.ok).toBe(true);
    expect(captured[0]?.url).toBe("http://localhost:11434/v1/embeddings");
    expect(captured[0]?.body).toMatchObject({ model: "text-embedding-3-large" });
  });

  test("uses configured embedding dimensions from parsed config", async () => {
    const captured: CapturedRequest[] = [];
    const provider = createOpenAiEmbeddingProviderFromConfig(
      {
        provider: "openai",
        apiKey: "local-placeholder-key",
        model: "qwen3-embedding",
        baseUrl: "http://localhost:11434/v1",
        dimensions: 1536
      },
      {
        fetchImpl: createCapturingFetch(
          {
            object: "list",
            data: [{ object: "embedding", index: 0, embedding: Array.from({ length: 1536 }, () => 0.1) }],
            model: "qwen3-embedding",
            usage: { prompt_tokens: 1, total_tokens: 1 }
          },
          captured
        )
      }
    );

    const result = await provider.embedTexts({ texts: ["configured"] });

    expect(result.ok).toBe(true);
    expect(captured[0]?.body).toMatchObject({
      model: "qwen3-embedding",
      dimensions: 1536
    });
  });
});
