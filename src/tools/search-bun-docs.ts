import * as z from "zod/v4";
import type { CacheStatus, Confidence, Recommendation, ResponseWarning, SourceCitation } from "../shared/contracts";
import { createInvalidInputError, type StructuredError } from "../shared/errors";
import type { BunDocsTopic } from "../sources/bun-docs-index";
import { searchDocs, type SearchDocsDependencies, type SearchDocsFailure } from "./search-docs";
import type { DocsRetrievalMetadata, DocsRetrievalFreshness } from "../docs/retrieval/hybrid-retrieval";

const topicSchema = z.enum([
  "runtime",
  "package-manager",
  "test-runner",
  "bundler",
  "typescript",
  "workspaces",
  "deployment",
  "security",
  "unknown"
]);

export const searchBunDocsInputSchema = z
  .object({
    query: z.string().min(1),
    topic: topicSchema.optional(),
    limit: z.number().int().min(1).optional(),
    forceRefresh: z.boolean().optional()
  })
  .strict();

export interface BunDocsCompatibilityResultItem {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
  readonly relevanceScore: number;
  readonly fetchedAt: string;
  readonly chunkId: number;
  readonly pageId: number;
  readonly headingPath: readonly string[];
  readonly contentHash: string;
  readonly keywordScore: number;
  readonly vectorScore: number;
  readonly rerankScore: number;
}

export interface SearchBunDocsSuccess {
  readonly ok: true;
  readonly query: string;
  readonly sourceId: "bun";
  readonly topic: BunDocsTopic | "unknown";
  readonly mode: "hybrid";
  readonly results: BunDocsCompatibilityResultItem[];
  readonly sources: SourceCitation[];
  readonly cacheStatus: Extract<CacheStatus, "fresh" | "stale">;
  readonly freshness: DocsRetrievalFreshness;
  readonly confidence: Confidence;
  readonly recommendations: Recommendation[];
  readonly warnings: ResponseWarning[];
  readonly retrieval: DocsRetrievalMetadata;
  readonly refreshQueued: boolean;
  readonly refreshReason?: string;
}

export interface SearchBunDocsFailure {
  readonly ok: false;
  readonly error: StructuredError;
}

export type SearchBunDocsResult = SearchBunDocsSuccess | SearchBunDocsFailure;
export type SearchBunDocsDependencies = SearchDocsDependencies;

function topicBoostTerms(topic: BunDocsTopic | "unknown" | undefined): string {
  switch (topic) {
    case "typescript":
      return "typescript @types/bun tsconfig";
    case "package-manager":
      return "package manager install lockfile bun.lock bun.lockb";
    case "test-runner":
      return "test runner bun:test";
    case "bundler":
      return "bundler build bundle";
    case "workspaces":
      return "workspaces workspace packages";
    case "deployment":
      return "deployment production";
    case "security":
      return "security permissions secrets";
    case "runtime":
      return "runtime Bun.serve Bun.file";
    case "unknown":
    case undefined:
      return "";
  }
}

function retrievalQuery(query: string, topic: BunDocsTopic | "unknown" | undefined): string {
  const boost = topicBoostTerms(topic);
  return boost.length === 0 ? query : `${query} ${boost}`;
}

function cacheStatusFor(freshness: DocsRetrievalFreshness): Extract<CacheStatus, "fresh" | "stale"> {
  return freshness === "fresh" ? "fresh" : "stale";
}

function mapWarning(warning: { readonly code: string; readonly message: string }): ResponseWarning {
  return {
    id: warning.code,
    title: warning.code,
    detail: warning.message,
    evidence: [],
    sources: []
  };
}

function mapFailure(result: SearchDocsFailure): SearchBunDocsFailure {
  return {
    ok: false,
    error: result.error
  };
}

export async function searchBunDocs(
  input: unknown,
  dependencies: SearchBunDocsDependencies
): Promise<SearchBunDocsResult> {
  const parsed = searchBunDocsInputSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      error: createInvalidInputError(parsed.error)
    };
  }

  const topic = parsed.data.topic ?? "unknown";
  const docsResult = await searchDocs(
    {
      sourceId: "bun",
      query: retrievalQuery(parsed.data.query, topic),
      ...(parsed.data.limit === undefined ? {} : { limit: parsed.data.limit }),
      mode: "hybrid",
      ...(parsed.data.forceRefresh === undefined ? {} : { forceRefresh: parsed.data.forceRefresh })
    },
    dependencies
  );

  if (!docsResult.ok) {
    return mapFailure(docsResult);
  }

  return {
    ok: true,
    query: parsed.data.query,
    sourceId: "bun",
    topic,
    mode: "hybrid",
    results: docsResult.results.map((item) => ({
      title: item.title,
      url: item.url,
      snippet: item.snippet,
      relevanceScore: item.score,
      fetchedAt: item.fetchedAt,
      chunkId: item.chunkId,
      pageId: item.pageId,
      headingPath: item.headingPath,
      contentHash: item.contentHash,
      keywordScore: item.keywordScore,
      vectorScore: item.vectorScore,
      rerankScore: item.rerankScore
    })),
    sources: [...docsResult.sources],
    cacheStatus: cacheStatusFor(docsResult.freshness),
    freshness: docsResult.freshness,
    confidence: docsResult.confidence,
    recommendations: [],
    warnings: docsResult.warnings.map(mapWarning),
    retrieval: docsResult.retrieval,
    refreshQueued: docsResult.refreshQueued,
    ...(docsResult.refreshReason === undefined ? {} : { refreshReason: docsResult.refreshReason })
  };
}
