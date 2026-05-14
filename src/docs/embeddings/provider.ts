import { createStructuredError, type StructuredError } from "../../shared/errors";

export interface EmbeddingProviderMetadata {
  readonly provider: string;
  readonly model: string;
  readonly dimensions: number;
  readonly embeddingVersion: string;
}

export interface EmbedTextsRequest {
  readonly texts: readonly string[];
}

export interface TextEmbedding {
  readonly index: number;
  readonly text: string;
  readonly vector: readonly number[];
}

export interface EmbedTextsSuccess {
  readonly ok: true;
  readonly metadata: EmbeddingProviderMetadata;
  readonly embeddings: readonly TextEmbedding[];
}

export interface EmbedTextsFailure {
  readonly ok: false;
  readonly error: StructuredError;
}

export type EmbedTextsResult = EmbedTextsSuccess | EmbedTextsFailure;

export interface EmbeddingProvider {
  readonly metadata: EmbeddingProviderMetadata;
  readonly embedTexts: (request: EmbedTextsRequest) => Promise<EmbedTextsResult>;
}

export interface EmbeddingDimensionValidationSuccess {
  readonly ok: true;
}

export interface EmbeddingDimensionValidationFailure {
  readonly ok: false;
  readonly error: StructuredError;
}

export type EmbeddingDimensionValidationResult =
  | EmbeddingDimensionValidationSuccess
  | EmbeddingDimensionValidationFailure;

export function createEmbeddingProviderFailure(provider: string, reason: string): StructuredError {
  return createStructuredError("fetch_failed", "Embedding provider request failed.", {
    provider,
    reason
  });
}

export function validateEmbeddingDimensions(
  vector: readonly number[],
  expectedDimensions: number
): EmbeddingDimensionValidationResult {
  if (vector.length !== expectedDimensions) {
    return {
      ok: false,
      error: createStructuredError("invalid_input", "Embedding vector dimension mismatch.", {
        expectedDimensions,
        actualDimensions: vector.length
      })
    };
  }

  if (vector.some((value) => !Number.isFinite(value))) {
    return {
      ok: false,
      error: createStructuredError("invalid_input", "Embedding vector contains a non-finite value.", {
        expectedDimensions,
        actualDimensions: vector.length,
        reason: "Embedding vector contains a non-finite value."
      })
    };
  }

  return { ok: true };
}
