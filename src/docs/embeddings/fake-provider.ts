import { createHash } from "node:crypto";
import {
  validateEmbeddingDimensions,
  type EmbedTextsRequest,
  type EmbedTextsResult,
  type EmbeddingProvider,
  type EmbeddingProviderMetadata
} from "./provider";
import type { StructuredError } from "../../shared/errors";

export interface FakeEmbeddingProviderOptions {
  readonly provider?: string;
  readonly model?: string;
  readonly dimensions?: number;
  readonly embeddingVersion?: string;
  readonly failWith?: StructuredError;
}

export class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly metadata: EmbeddingProviderMetadata;
  private readonly failWith: StructuredError | undefined;

  constructor(options: FakeEmbeddingProviderOptions = {}) {
    const provider = options.provider ?? "fake";
    const model = options.model ?? "fake-deterministic";
    const dimensions = options.dimensions ?? 16;

    this.metadata = {
      provider,
      model,
      dimensions,
      embeddingVersion: options.embeddingVersion ?? `${model}:v1`
    };
    this.failWith = options.failWith;
  }

  async embedTexts(request: EmbedTextsRequest): Promise<EmbedTextsResult> {
    if (this.failWith !== undefined) {
      return {
        ok: false,
        error: this.failWith
      };
    }

    const embeddings = request.texts.map((text, index) => {
      const vector = fakeVector(text, this.metadata.dimensions);
      const validation = validateEmbeddingDimensions(vector, this.metadata.dimensions);

      if (!validation.ok) {
        throw new Error(validation.error.message);
      }

      return {
        index,
        text,
        vector
      };
    });

    return {
      ok: true,
      metadata: this.metadata,
      embeddings
    };
  }
}

function fakeVector(text: string, dimensions: number): number[] {
  return Array.from({ length: dimensions }, (_, index) => {
    const digest = createHash("sha256").update(`${text}\0${index}`).digest();
    const unsigned = digest.readUInt32BE(0);
    const unit = unsigned / 0xffffffff;
    return Number((unit * 2 - 1).toFixed(8));
  });
}
