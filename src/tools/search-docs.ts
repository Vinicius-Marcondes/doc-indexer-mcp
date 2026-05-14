import * as z from "zod/v4";
import type { SourceCitation } from "../shared/contracts";
import { createInvalidInputError, createStructuredError, type StructuredError } from "../shared/errors";
import type {
  DocsRetrievalInput,
  DocsRetrievalResult
} from "../docs/retrieval/hybrid-retrieval";
import { defaultDocsSourceRegistry } from "../docs/sources/bun-source-pack";
import type { DocsSourceRegistry } from "../docs/sources/registry";

const searchDocsModeSchema = z.enum(["hybrid", "keyword", "semantic"]);

export const searchDocsInputSchema = z
  .object({
    query: z.string().min(1),
    sourceId: z.string().min(1).optional(),
    limit: z.number().int().min(1).optional(),
    mode: searchDocsModeSchema.optional(),
    forceRefresh: z.boolean().optional()
  })
  .strict();

export interface SearchDocsRetrieval {
  readonly search: (input: DocsRetrievalInput) => Promise<DocsRetrievalResult>;
}

export interface SearchDocsDependencies {
  readonly retrieval?: SearchDocsRetrieval;
  readonly sourceRegistry?: DocsSourceRegistry;
  readonly now: () => string;
  readonly defaultLimit: number;
  readonly maxLimit: number;
}

export interface SearchDocsFailure {
  readonly ok: false;
  readonly error: StructuredError;
}

export interface SearchDocsSuccess extends Omit<DocsRetrievalResult, "lowConfidence"> {
  readonly ok: true;
  readonly generatedAt: string;
  readonly sources: readonly SourceCitation[];
}

export type SearchDocsResult = SearchDocsSuccess | SearchDocsFailure;

function sourceTypeFor(sourceId: string): SourceCitation["sourceType"] {
  if (sourceId === "bun") {
    return "bun-docs";
  }

  return "bun-docs";
}

function buildSources(result: DocsRetrievalResult): SourceCitation[] {
  const byUrl = new Map<string, SourceCitation>();

  for (const item of result.results) {
    if (byUrl.has(item.url)) {
      continue;
    }

    byUrl.set(item.url, {
      title: item.title,
      url: item.url,
      sourceType: sourceTypeFor(result.sourceId),
      fetchedAt: item.fetchedAt,
      contentHash: item.contentHash
    });
  }

  return [...byUrl.values()];
}

function limitError(actualLimit: number, maxLimit: number): StructuredError {
  return createStructuredError("invalid_input", "Invalid input: limit exceeds the configured maximum.", {
    limit: actualLimit,
    maxLimit
  });
}

function missingRetrievalError(): StructuredError {
  return createStructuredError("internal_error", "Docs retrieval service is not configured.");
}

export async function searchDocs(input: unknown, dependencies: SearchDocsDependencies): Promise<SearchDocsResult> {
  const parsed = searchDocsInputSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      error: createInvalidInputError(parsed.error)
    };
  }

  const sourceRegistry = dependencies.sourceRegistry ?? defaultDocsSourceRegistry;
  const sourceId = parsed.data.sourceId ?? "bun";
  const sourcePack = sourceRegistry.get(sourceId);

  if (sourcePack === undefined || !sourcePack.enabled) {
    return {
      ok: false,
      error: createStructuredError("disallowed_source", "Docs source is not enabled for this MCP server.", {
        sourceId,
        allowedSourceIds: sourceRegistry.list().map((source) => source.sourceId)
      })
    };
  }

  const limit = parsed.data.limit ?? dependencies.defaultLimit;

  if (limit > dependencies.maxLimit) {
    return {
      ok: false,
      error: limitError(limit, dependencies.maxLimit)
    };
  }

  if (dependencies.retrieval === undefined) {
    return {
      ok: false,
      error: missingRetrievalError()
    };
  }

  const retrievalResult = await dependencies.retrieval.search({
    sourceId,
    query: parsed.data.query,
    limit,
    mode: parsed.data.mode ?? "hybrid"
  });

  return {
    ok: true,
    generatedAt: dependencies.now(),
    query: retrievalResult.query,
    sourceId: retrievalResult.sourceId,
    mode: retrievalResult.mode,
    limit: retrievalResult.limit,
    results: retrievalResult.results,
    sources: buildSources(retrievalResult),
    freshness: retrievalResult.freshness,
    confidence: retrievalResult.confidence,
    refreshQueued: retrievalResult.refreshQueued,
    ...(retrievalResult.refreshReason === undefined ? {} : { refreshReason: retrievalResult.refreshReason }),
    retrieval: retrievalResult.retrieval,
    warnings: retrievalResult.warnings
  };
}
