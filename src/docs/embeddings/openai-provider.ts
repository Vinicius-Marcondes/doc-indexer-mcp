import OpenAI from "openai";
import type { RemoteDocsConfig } from "../../config/remote-docs-config";
import { createStructuredError, type StructuredError } from "../../shared/errors";
import {
  validateEmbeddingDimensions,
  type EmbedTextsRequest,
  type EmbedTextsResult,
  type EmbeddingProvider,
  type EmbeddingProviderMetadata,
  type TextEmbedding
} from "./provider";

export type OpenAiEmbeddingFetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface OpenAiEmbeddingProviderOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly dimensions?: number;
  readonly embeddingVersion?: string;
  readonly batchSize?: number;
  readonly fetchImpl?: OpenAiEmbeddingFetchLike;
}

export interface OpenAiEmbeddingProviderFactoryOptions {
  readonly dimensions?: number;
  readonly embeddingVersion?: string;
  readonly batchSize?: number;
  readonly fetchImpl?: OpenAiEmbeddingFetchLike;
}

function defaultDimensionsForModel(model: string): number {
  if (model === "text-embedding-3-large") {
    return 3072;
  }

  return 1536;
}

function parseFailedError(reason: string): StructuredError {
  return createStructuredError("parse_failed", "OpenAI embedding response did not match the expected shape.", {
    provider: "openai",
    reason
  });
}

function providerFetchError(error: unknown): StructuredError {
  const status = typeof (error as { status?: unknown }).status === "number" ? (error as { status: number }).status : undefined;
  const retryable = status === 429 || (status !== undefined && status >= 500);

  return createStructuredError("fetch_failed", "OpenAI embedding request failed.", {
    provider: "openai",
    retryable,
    ...(status === undefined ? {} : { status })
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseOpenAiEmbeddingResponse(
  response: unknown,
  texts: readonly string[],
  globalOffset: number,
  dimensions: number
): { ok: true; embeddings: readonly TextEmbedding[] } | { ok: false; error: StructuredError } {
  if (!isRecord(response) || !Array.isArray(response.data)) {
    return { ok: false, error: parseFailedError("Response must contain a data array.") };
  }

  const embeddingsByLocalIndex = new Map<number, readonly number[]>();

  for (const item of response.data) {
    if (!isRecord(item) || typeof item.index !== "number" || !Number.isInteger(item.index) || !Array.isArray(item.embedding)) {
      return { ok: false, error: parseFailedError("Each embedding item must include index and embedding.") };
    }

    if (!item.embedding.every((value) => typeof value === "number")) {
      return { ok: false, error: parseFailedError("Embedding values must be numbers.") };
    }

    embeddingsByLocalIndex.set(item.index, item.embedding);
  }

  const embeddings: TextEmbedding[] = [];

  for (const [localIndex, text] of texts.entries()) {
    const vector = embeddingsByLocalIndex.get(localIndex);

    if (vector === undefined) {
      return { ok: false, error: parseFailedError(`Missing embedding for input index ${localIndex}.`) };
    }

    const validation = validateEmbeddingDimensions(vector, dimensions);

    if (!validation.ok) {
      return {
        ok: false,
        error: validation.error
      };
    }

    embeddings.push({
      index: globalOffset + localIndex,
      text,
      vector
    });
  }

  return { ok: true, embeddings };
}

function batches<T>(items: readonly T[], batchSize: number): readonly T[][] {
  const result: T[][] = [];

  for (let index = 0; index < items.length; index += batchSize) {
    result.push(items.slice(index, index + batchSize));
  }

  return result;
}

export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  readonly metadata: EmbeddingProviderMetadata;
  private readonly client: OpenAI;
  private readonly batchSize: number;
  private readonly requestedDimensions: number | undefined;

  constructor(options: OpenAiEmbeddingProviderOptions) {
    const dimensions = options.dimensions ?? defaultDimensionsForModel(options.model);

    this.metadata = {
      provider: "openai",
      model: options.model,
      dimensions,
      embeddingVersion: options.embeddingVersion ?? `${options.model}:${dimensions}`
    };
    this.requestedDimensions = options.dimensions;
    this.batchSize = Math.max(1, options.batchSize ?? 128);
    this.client = new OpenAI({
      apiKey: options.apiKey,
      maxRetries: 0,
      ...(options.fetchImpl === undefined ? {} : { fetch: options.fetchImpl as unknown as typeof fetch })
    });
  }

  async embedTexts(request: EmbedTextsRequest): Promise<EmbedTextsResult> {
    const embeddings: TextEmbedding[] = [];
    let offset = 0;

    for (const batch of batches(request.texts, this.batchSize)) {
      try {
        const response = await this.client.embeddings.create({
          model: this.metadata.model,
          input: batch,
          encoding_format: "float",
          ...(this.requestedDimensions === undefined ? {} : { dimensions: this.requestedDimensions })
        });
        const parsed = parseOpenAiEmbeddingResponse(response, batch, offset, this.metadata.dimensions);

        if (!parsed.ok) {
          return parsed;
        }

        embeddings.push(...parsed.embeddings);
        offset += batch.length;
      } catch (error) {
        return {
          ok: false,
          error: providerFetchError(error)
        };
      }
    }

    return {
      ok: true,
      metadata: this.metadata,
      embeddings
    };
  }
}

export function createOpenAiEmbeddingProviderFromConfig(
  config: RemoteDocsConfig["embeddings"],
  options: OpenAiEmbeddingProviderFactoryOptions = {}
): OpenAiEmbeddingProvider {
  return new OpenAiEmbeddingProvider({
    apiKey: config.apiKey,
    model: config.model,
    ...(options.dimensions === undefined ? {} : { dimensions: options.dimensions }),
    ...(options.embeddingVersion === undefined ? {} : { embeddingVersion: options.embeddingVersion }),
    ...(options.batchSize === undefined ? {} : { batchSize: options.batchSize }),
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl })
  });
}
