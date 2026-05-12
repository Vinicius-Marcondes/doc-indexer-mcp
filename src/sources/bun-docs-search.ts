import { resolveWithCacheFallback } from "../cache/fallback-policy";
import type { CacheStatus, Confidence, Recommendation, ResponseWarning, SourceCitation } from "../shared/contracts";
import type { StructuredError } from "../shared/errors";
import type { SqliteCacheStore } from "../cache/sqlite-cache";
import type { SourceFetchClient } from "./fetch-client";
import type { BunDocsTopic } from "./bun-docs-index";

export const BUN_DOCS_FULL_URL = "https://bun.com/docs/llms-full.txt";
const DEFAULT_BUN_DOCS_TTL_MS = 24 * 60 * 60 * 1000;

export interface BunDocsSection {
  readonly title: string;
  readonly url: string;
  readonly content: string;
  readonly fetchedAt: string;
}

export interface BunDocsSearchInput {
  readonly query: string;
  readonly topic?: BunDocsTopic;
  readonly limit?: number;
}

export interface BunDocsSearchResultItem {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
  readonly relevanceScore: number;
  readonly fetchedAt: string;
}

export interface BunDocsSearchSuccess {
  readonly ok: true;
  readonly query: string;
  readonly topic: BunDocsTopic | "unknown";
  readonly results: BunDocsSearchResultItem[];
  readonly sources: SourceCitation[];
  readonly cacheStatus: Extract<CacheStatus, "fresh" | "stale">;
  readonly confidence: Confidence;
  readonly recommendations: Recommendation[];
  readonly warnings: ResponseWarning[];
}

export interface BunDocsSearchFailure {
  readonly ok: false;
  readonly error: StructuredError;
}

export type BunDocsSearchResult = BunDocsSearchSuccess | BunDocsSearchFailure;

export interface BunDocsSearchAdapterOptions {
  readonly cache: SqliteCacheStore;
  readonly fetchClient: SourceFetchClient;
  readonly now?: () => string;
  readonly ttlMs?: number;
}

function normalizeText(text: string): string {
  return text
    .replace(/<[^>]+>/gu, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, "$1")
    .replace(/\s+/gu, " ")
    .trim();
}

function termsFor(query: string): string[] {
  return [...new Set(query.toLowerCase().split(/[^a-z0-9@:.]+/u).filter((term) => term.length > 1))];
}

function inferTopic(title: string, url: string): BunDocsTopic {
  const haystack = `${title} ${url}`.toLowerCase();

  if (haystack.includes("typescript")) {
    return "typescript";
  }

  if (haystack.includes("workspace")) {
    return "workspaces";
  }

  if (haystack.includes("test")) {
    return "test-runner";
  }

  if (haystack.includes("lockfile") || haystack.includes("/pm") || haystack.includes("install")) {
    return "package-manager";
  }

  if (haystack.includes("bundl")) {
    return "bundler";
  }

  if (haystack.includes("deploy")) {
    return "deployment";
  }

  if (haystack.includes("security")) {
    return "security";
  }

  if (haystack.includes("runtime")) {
    return "runtime";
  }

  return "unknown";
}

function scoreSection(section: BunDocsSection, query: string, topic: BunDocsTopic | undefined): number {
  const queryText = query.toLowerCase();
  const title = section.title.toLowerCase();
  const content = section.content.toLowerCase();
  const terms = termsFor(query);
  let score = 0;

  if (title.includes(queryText)) {
    score += 200;
  }

  if (content.includes(queryText)) {
    score += 40;
  }

  for (const term of terms) {
    if (title.includes(term)) {
      score += 60;
    }

    const matches = content.match(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "gu"));
    score += matches === null ? 0 : matches.length * 8;
  }

  if (topic !== undefined && inferTopic(section.title, section.url) === topic) {
    score += 25;
  }

  return score;
}

function sentenceScore(sentence: string, terms: string[]): number {
  const lower = sentence.toLowerCase();
  return terms.reduce((score, term) => {
    const pattern = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "gu");
    return score + (lower.match(pattern)?.length ?? 0);
  }, 0);
}

function snippetFor(section: BunDocsSection, query: string): string {
  const normalized = normalizeText(section.content);
  const terms = termsFor(query);
  const sentences = normalized.split(/(?<=[.!?])\s+/u).filter((sentence) => sentence.length > 0);
  const fallback = normalized.slice(0, 220);

  if (sentences.length === 0 || terms.length === 0) {
    return fallback;
  }

  const best = sentences.reduce(
    (current, sentence) => {
      const score = sentenceScore(sentence, terms);
      return score >= current.score ? { sentence, score } : current;
    },
    { sentence: sentences[0] ?? fallback, score: -1 }
  );

  return best.sentence.length > 220 ? `${best.sentence.slice(0, 217)}...` : best.sentence;
}

function resultSource(result: BunDocsSearchResultItem): SourceCitation {
  return {
    title: result.title,
    url: result.url,
    sourceType: "bun-docs",
    fetchedAt: result.fetchedAt
  };
}

function emptyResultWarning(query: string): ResponseWarning {
  return {
    id: "bun-docs-no-match",
    title: "No Bun docs match",
    detail: `No official Bun documentation section matched the query "${query}".`,
    evidence: [],
    sources: [BUN_DOCS_FULL_URL]
  };
}

function extractSectionUrl(lines: string[]): string {
  for (const line of lines) {
    const match = /(https:\/\/bun\.com\/docs\/\S+)/u.exec(line);

    if (match?.[1] !== undefined) {
      return match[1].replace(/[),.;]+$/u, "");
    }
  }

  return BUN_DOCS_FULL_URL;
}

export function parseBunDocsContent(content: string, fetchedAt: string): BunDocsSection[] {
  const sections: BunDocsSection[] = [];
  let currentTitle = "Bun docs";
  let currentLines: string[] = [];

  function flush(): void {
    const bodyLines = currentLines.filter((line) => !/^\s*URL:\s*https:\/\/bun\.com\/docs\//u.test(line));
    const body = normalizeText(bodyLines.join("\n"));

    if (body.length === 0) {
      return;
    }

    sections.push({
      title: currentTitle,
      url: extractSectionUrl(currentLines),
      content: body,
      fetchedAt
    });
  }

  for (const line of content.split(/\r?\n/u)) {
    const heading = /^(#{1,6})\s+(.+)$/u.exec(line);

    if (heading?.[2] !== undefined) {
      flush();
      currentTitle = heading[2].trim();
      currentLines = [];
      continue;
    }

    currentLines.push(line);
  }

  flush();
  return sections;
}

export class BunDocsSearchAdapter {
  private readonly cache: SqliteCacheStore;
  private readonly fetchClient: SourceFetchClient;
  private readonly now: () => string;
  private readonly ttlMs: number;

  constructor(options: BunDocsSearchAdapterOptions) {
    this.cache = options.cache;
    this.fetchClient = options.fetchClient;
    this.now = options.now ?? (() => new Date().toISOString());
    this.ttlMs = options.ttlMs ?? DEFAULT_BUN_DOCS_TTL_MS;
  }

  async search(input: BunDocsSearchInput): Promise<BunDocsSearchResult> {
    const resolved = await resolveWithCacheFallback({
      cache: this.cache,
      key: BUN_DOCS_FULL_URL,
      sourceType: "bun-docs",
      sourceUrl: BUN_DOCS_FULL_URL,
      now: this.now(),
      ttlMs: this.ttlMs,
      fetchFresh: async () => {
        const fetched = await this.fetchClient.fetchText(BUN_DOCS_FULL_URL);

        if (!fetched.ok) {
          throw new Error(fetched.error.message);
        }

        return {
          content: fetched.body,
          status: String(fetched.status),
          sourceUrl: fetched.finalUrl
        };
      }
    });

    if (!resolved.ok) {
      return resolved;
    }

    const scored = parseBunDocsContent(resolved.content, resolved.entry.fetchedAt)
      .map((section) => ({
        section,
        relevanceScore: scoreSection(section, input.query, input.topic)
      }))
      .filter((item) => item.relevanceScore > 0)
      .sort((left, right) => right.relevanceScore - left.relevanceScore)
      .slice(0, input.limit ?? 5)
      .map(({ section, relevanceScore }) => ({
        title: section.title,
        url: section.url,
        snippet: snippetFor(section, input.query),
        relevanceScore,
        fetchedAt: section.fetchedAt
      }));

    const seenSources = new Set<string>();
    const sources = scored
      .filter((result) => {
        if (seenSources.has(result.url)) {
          return false;
        }

        seenSources.add(result.url);
        return true;
      })
      .map(resultSource);

    return {
      ok: true,
      query: input.query,
      topic: input.topic ?? "unknown",
      results: scored,
      sources,
      cacheStatus: resolved.cacheStatus,
      confidence: resolved.confidence,
      recommendations: [],
      warnings: scored.length === 0 ? [...resolved.warnings, emptyResultWarning(input.query)] : resolved.warnings
    };
  }
}
