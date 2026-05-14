import { createHash } from "node:crypto";
import {
  extractExactKeywordTerms,
  type KeywordRetrievalResultItem,
  type KeywordSearchInput,
  type KeywordSearchResult
} from "./keyword-retrieval";
import type {
  VectorRetrievalResultItem,
  VectorSearchInput,
  VectorSearchResult
} from "./vector-retrieval";
import type {
  RecordRetrievalEventInput,
  RetrievalConfidence,
  RetrievalMode
} from "../storage/docs-storage";
import type { StructuredError } from "../../shared/errors";

export type DocsRetrievalFreshness = "fresh" | "stale" | "missing" | "refreshing";
export type DocsRetrievalWarningCode =
  | "no_results"
  | "stale_results"
  | "semantic_retrieval_failed"
  | "low_relevance"
  | "telemetry_failed";
export type DocsRefreshReason = "missing_content" | "stale_content" | "low_confidence";

export interface DocsRetrievalWarning {
  readonly code: DocsRetrievalWarningCode;
  readonly message: string;
  readonly details?: Record<string, unknown>;
}

export interface DocsRetrievalInput {
  readonly sourceId: string;
  readonly query: string;
  readonly mode?: RetrievalMode;
  readonly limit?: number;
}

export interface DocsRetrievalResultItem {
  readonly chunkId: number;
  readonly pageId: number;
  readonly title: string;
  readonly url: string;
  readonly headingPath: readonly string[];
  readonly snippet: string;
  readonly score: number;
  readonly keywordScore: number;
  readonly vectorScore: number;
  readonly rerankScore: number;
  readonly fetchedAt: string;
  readonly indexedAt: string;
  readonly contentHash: string;
}

export interface DocsRetrievalMetadata {
  readonly mode: RetrievalMode;
  readonly keywordAttempted: boolean;
  readonly vectorAttempted: boolean;
  readonly keywordResultCount: number;
  readonly vectorResultCount: number;
  readonly mergedResultCount: number;
  readonly queryHash: string;
}

export interface DocsRetrievalResult {
  readonly query: string;
  readonly sourceId: string;
  readonly mode: RetrievalMode;
  readonly limit: number;
  readonly results: readonly DocsRetrievalResultItem[];
  readonly freshness: DocsRetrievalFreshness;
  readonly confidence: RetrievalConfidence;
  readonly lowConfidence: boolean;
  readonly refreshQueued: false;
  readonly refreshReason?: DocsRefreshReason;
  readonly retrieval: DocsRetrievalMetadata;
  readonly warnings: readonly DocsRetrievalWarning[];
}

export interface DocsKeywordRetriever {
  readonly search: (input: KeywordSearchInput) => Promise<KeywordSearchResult>;
}

export interface DocsVectorRetriever {
  readonly search: (input: VectorSearchInput) => Promise<VectorSearchResult>;
}

export interface DocsRetrievalTelemetryRecorder {
  readonly recordRetrievalEvent: (input: RecordRetrievalEventInput) => Promise<unknown>;
}

export interface HybridDocsRetrievalOptions {
  readonly keywordRetrieval: DocsKeywordRetriever;
  readonly vectorRetrieval: DocsVectorRetriever;
  readonly telemetry?: DocsRetrievalTelemetryRecorder;
  readonly defaultLimit: number;
  readonly maxLimit: number;
  readonly now?: () => Date;
  readonly freshnessMaxAgeMs?: number;
}

interface PartialMergedItem {
  readonly chunkId: number;
  readonly pageId: number;
  readonly title: string;
  readonly url: string;
  readonly headingPath: readonly string[];
  readonly snippet: string;
  readonly keywordScore: number;
  readonly vectorScore: number;
  readonly fetchedAt: string;
  readonly indexedAt: string;
  readonly contentHash: string;
}

const DEFAULT_FRESHNESS_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function hashRetrievalQuery(sourceId: string, query: string): string {
  return createHash("sha256").update(`${sourceId}\0${query.trim()}`).digest("hex");
}

export function boundHybridRetrievalLimit(limit: number | undefined, defaultLimit: number, maxLimit: number): number {
  const selectedLimit = limit === undefined ? defaultLimit : Math.floor(limit);
  return Math.min(Math.max(selectedLimit, 1), maxLimit);
}

function hasExactMatch(query: string, item: Pick<DocsRetrievalResultItem, "title" | "headingPath" | "snippet">): boolean {
  const haystack = `${item.title} ${item.headingPath.join(" ")} ${item.snippet}`.toLowerCase();
  return extractExactKeywordTerms(query).some((term) => haystack.includes(term.toLowerCase()));
}

function shouldPreferIncomingSnippet(
  query: string,
  existing: PartialMergedItem,
  incoming: KeywordRetrievalResultItem | VectorRetrievalResultItem
): boolean {
  const existingHasExact = hasExactMatch(query, existing);
  const incomingHasExact = hasExactMatch(query, incoming);

  if (incomingHasExact && !existingHasExact) {
    return true;
  }

  return incoming.keywordScore > 0 && existing.keywordScore === 0;
}

function mergeRetrievalItems(
  query: string,
  keywordItems: readonly KeywordRetrievalResultItem[],
  vectorItems: readonly VectorRetrievalResultItem[]
): PartialMergedItem[] {
  const mergedByChunk = new Map<number, PartialMergedItem>();

  for (const item of [...keywordItems, ...vectorItems]) {
    const existing = mergedByChunk.get(item.chunkId);

    if (existing === undefined) {
      mergedByChunk.set(item.chunkId, {
        chunkId: item.chunkId,
        pageId: item.pageId,
        title: item.title,
        url: item.url,
        headingPath: item.headingPath,
        snippet: item.snippet,
        keywordScore: item.keywordScore,
        vectorScore: item.vectorScore,
        fetchedAt: item.fetchedAt,
        indexedAt: item.indexedAt,
        contentHash: item.contentHash
      });
      continue;
    }

    mergedByChunk.set(item.chunkId, {
      ...existing,
      snippet: shouldPreferIncomingSnippet(query, existing, item) ? item.snippet : existing.snippet,
      keywordScore: Math.max(existing.keywordScore, item.keywordScore),
      vectorScore: Math.max(existing.vectorScore, item.vectorScore)
    });
  }

  return [...mergedByChunk.values()];
}

function scoreMergedItem(query: string, item: PartialMergedItem): DocsRetrievalResultItem {
  const exactBoost = hasExactMatch(query, item) ? 2 : 0;
  const keywordContribution = Math.max(0, item.keywordScore) * 1.5;
  const vectorContribution = Math.max(0, item.vectorScore);
  const score = keywordContribution + vectorContribution + exactBoost;

  return {
    ...item,
    score,
    rerankScore: exactBoost
  };
}

function isItemStale(item: DocsRetrievalResultItem, now: Date, freshnessMaxAgeMs: number): boolean {
  const fetchedAtMs = Date.parse(item.fetchedAt);

  if (Number.isNaN(fetchedAtMs)) {
    return true;
  }

  return now.getTime() - fetchedAtMs > freshnessMaxAgeMs;
}

function computeFreshness(
  results: readonly DocsRetrievalResultItem[],
  now: Date,
  freshnessMaxAgeMs: number
): DocsRetrievalFreshness {
  if (results.length === 0) {
    return "missing";
  }

  return results.some((item) => isItemStale(item, now, freshnessMaxAgeMs)) ? "stale" : "fresh";
}

function computeConfidence(input: {
  readonly results: readonly DocsRetrievalResultItem[];
  readonly freshness: DocsRetrievalFreshness;
  readonly semanticFailure: StructuredError | null;
}): RetrievalConfidence {
  if (input.results.length === 0) {
    return "low";
  }

  const topScore = input.results[0]?.score ?? 0;

  if (input.freshness === "stale" || input.semanticFailure !== null) {
    return topScore < 0.25 ? "low" : "medium";
  }

  return topScore < 0.25 ? "low" : "high";
}

function computeRefreshReason(
  freshness: DocsRetrievalFreshness,
  confidence: RetrievalConfidence
): DocsRefreshReason | undefined {
  if (freshness === "missing") {
    return "missing_content";
  }

  if (freshness === "stale") {
    return "stale_content";
  }

  if (confidence === "low") {
    return "low_confidence";
  }

  return undefined;
}

function buildWarnings(input: {
  readonly freshness: DocsRetrievalFreshness;
  readonly confidence: RetrievalConfidence;
  readonly semanticFailure: StructuredError | null;
  readonly resultCount: number;
}): DocsRetrievalWarning[] {
  const warnings: DocsRetrievalWarning[] = [];

  if (input.semanticFailure !== null) {
    warnings.push({
      code: "semantic_retrieval_failed",
      message: "Semantic retrieval failed; results may be incomplete.",
      details: {
        code: input.semanticFailure.code,
        message: input.semanticFailure.message
      }
    });
  }

  if (input.resultCount === 0) {
    warnings.push({
      code: "no_results",
      message: "No indexed documentation evidence matched the query."
    });
  }

  if (input.freshness === "stale") {
    warnings.push({
      code: "stale_results",
      message: "One or more retrieved documentation chunks are stale."
    });
  }

  if (input.confidence === "low" && input.resultCount > 0) {
    warnings.push({
      code: "low_relevance",
      message: "Retrieved documentation evidence has low relevance."
    });
  }

  return warnings;
}

export class HybridDocsRetrieval {
  private readonly keywordRetrieval: DocsKeywordRetriever;
  private readonly vectorRetrieval: DocsVectorRetriever;
  private readonly telemetry: DocsRetrievalTelemetryRecorder | undefined;
  private readonly defaultLimit: number;
  private readonly maxLimit: number;
  private readonly now: () => Date;
  private readonly freshnessMaxAgeMs: number;

  constructor(options: HybridDocsRetrievalOptions) {
    this.keywordRetrieval = options.keywordRetrieval;
    this.vectorRetrieval = options.vectorRetrieval;
    this.telemetry = options.telemetry;
    this.defaultLimit = options.defaultLimit;
    this.maxLimit = options.maxLimit;
    this.now = options.now ?? (() => new Date());
    this.freshnessMaxAgeMs = options.freshnessMaxAgeMs ?? DEFAULT_FRESHNESS_MAX_AGE_MS;
  }

  async search(input: DocsRetrievalInput): Promise<DocsRetrievalResult> {
    const query = input.query.trim();
    const sourceId = input.sourceId;
    const mode = input.mode ?? "hybrid";
    const limit = boundHybridRetrievalLimit(input.limit, this.defaultLimit, this.maxLimit);
    const candidateLimit = Math.min(limit * 2, this.maxLimit);
    const keywordAttempted = mode === "keyword" || mode === "hybrid";
    const vectorAttempted = mode === "semantic" || mode === "hybrid";
    const keywordResult = keywordAttempted
      ? await this.keywordRetrieval.search({ sourceId, query, limit: candidateLimit })
      : null;
    const vectorResult = vectorAttempted
      ? await this.vectorRetrieval.search({ sourceId, query, limit: candidateLimit })
      : null;
    const semanticFailure = vectorResult !== null && !vectorResult.ok ? vectorResult.error : null;
    const keywordItems = keywordResult?.results ?? [];
    const vectorItems = vectorResult !== null && vectorResult.ok ? vectorResult.results : [];
    const results = mergeRetrievalItems(query, keywordItems, vectorItems)
      .map((item) => scoreMergedItem(query, item))
      .sort((left, right) => right.score - left.score || left.chunkId - right.chunkId)
      .slice(0, limit);
    const freshness = computeFreshness(results, this.now(), this.freshnessMaxAgeMs);
    const confidence = computeConfidence({ results, freshness, semanticFailure });
    const lowConfidence = confidence === "low";
    const queryHash = hashRetrievalQuery(sourceId, query);
    const retrieval: DocsRetrievalMetadata = {
      mode,
      keywordAttempted,
      vectorAttempted,
      keywordResultCount: keywordItems.length,
      vectorResultCount: vectorItems.length,
      mergedResultCount: results.length,
      queryHash
    };
    const warnings = buildWarnings({
      freshness,
      confidence,
      semanticFailure,
      resultCount: results.length
    });
    const result: DocsRetrievalResult = {
      query,
      sourceId,
      mode,
      limit,
      results,
      freshness,
      confidence,
      lowConfidence,
      refreshQueued: false,
      ...(computeRefreshReason(freshness, confidence) === undefined
        ? {}
        : { refreshReason: computeRefreshReason(freshness, confidence) }),
      retrieval,
      warnings
    };

    if (this.telemetry !== undefined) {
      try {
        await this.telemetry.recordRetrievalEvent({
          sourceId,
          queryHash,
          mode,
          resultCount: results.length,
          confidence,
          lowConfidence,
          refreshQueued: false
        });
      } catch {
        warnings.push({
          code: "telemetry_failed",
          message: "Retrieval telemetry could not be recorded."
        });
      }
    }

    return result;
  }
}
