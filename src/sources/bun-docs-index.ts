import type { CacheStatus, Confidence, ResponseWarning } from "../shared/contracts";
import type { StructuredError } from "../shared/errors";
import { resolveWithCacheFallback } from "../cache/fallback-policy";
import type { SqliteCacheStore } from "../cache/sqlite-cache";
import type { SourceFetchClient } from "./fetch-client";

export const BUN_DOCS_INDEX_URL = "https://bun.com/docs/llms.txt";
const DEFAULT_BUN_DOCS_TTL_MS = 24 * 60 * 60 * 1000;

export type BunDocsTopic =
  | "runtime"
  | "package-manager"
  | "test-runner"
  | "bundler"
  | "typescript"
  | "workspaces"
  | "deployment"
  | "security"
  | "unknown";

export interface BunDocsIndexPage {
  readonly title: string;
  readonly url: string;
  readonly topic: BunDocsTopic;
  readonly sourceUrl: string;
  readonly fetchedAt: string;
}

export interface BunDocsIndexSuccess {
  readonly ok: true;
  readonly pages: BunDocsIndexPage[];
  readonly sourceUrl: string;
  readonly fetchedAt: string;
  readonly cacheStatus: Extract<CacheStatus, "fresh" | "stale">;
  readonly confidence: Confidence;
  readonly warnings: ResponseWarning[];
}

export interface BunDocsIndexFailure {
  readonly ok: false;
  readonly error: StructuredError;
}

export type BunDocsIndexResult = BunDocsIndexSuccess | BunDocsIndexFailure;

export interface BunDocsIndexAdapterOptions {
  readonly cache: SqliteCacheStore;
  readonly fetchClient: SourceFetchClient;
  readonly now?: () => string;
  readonly ttlMs?: number;
}

function normalizeUrl(url: string): string {
  return url.replace(/[),.;]+$/u, "");
}

function topicFor(title: string, url: string): BunDocsTopic {
  const haystack = `${title} ${url}`.toLowerCase();

  if (haystack.includes("typescript")) {
    return "typescript";
  }

  if (haystack.includes("workspace")) {
    return "workspaces";
  }

  if (haystack.includes("/test") || haystack.includes("test runner") || haystack.includes("testing")) {
    return "test-runner";
  }

  if (haystack.includes("/pm") || haystack.includes("package") || haystack.includes("install")) {
    return "package-manager";
  }

  if (haystack.includes("bundler") || haystack.includes("bundle")) {
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

function addPage(
  pages: BunDocsIndexPage[],
  seen: Set<string>,
  title: string,
  url: string,
  fetchedAt: string
): void {
  const normalizedUrl = normalizeUrl(url);

  if (seen.has(normalizedUrl)) {
    return;
  }

  seen.add(normalizedUrl);
  pages.push({
    title: title.trim(),
    url: normalizedUrl,
    topic: topicFor(title, normalizedUrl),
    sourceUrl: BUN_DOCS_INDEX_URL,
    fetchedAt
  });
}

export function parseBunDocsIndex(content: string, fetchedAt: string): BunDocsIndexPage[] {
  const pages: BunDocsIndexPage[] = [];
  const seen = new Set<string>();
  const markdownLinkPattern = /\[([^\]]+)\]\((https:\/\/bun\.com\/docs\/[^)\s]+)\)/gu;
  const plainUrlPattern = /([^:\n]+):\s*(https:\/\/bun\.com\/docs\/\S+)/u;

  for (const line of content.split(/\r?\n/u)) {
    let matchedMarkdown = false;

    for (const match of line.matchAll(markdownLinkPattern)) {
      matchedMarkdown = true;
      addPage(pages, seen, match[1] ?? "Bun docs page", match[2] ?? "", fetchedAt);
    }

    if (matchedMarkdown) {
      continue;
    }

    const plainUrlMatch = plainUrlPattern.exec(line);

    if (plainUrlMatch !== null) {
      addPage(pages, seen, plainUrlMatch[1]?.replace(/^[-*\s]+/u, "").trim() ?? "Bun docs page", plainUrlMatch[2] ?? "", fetchedAt);
    }
  }

  return pages;
}

export class BunDocsIndexAdapter {
  private readonly cache: SqliteCacheStore;
  private readonly fetchClient: SourceFetchClient;
  private readonly now: () => string;
  private readonly ttlMs: number;

  constructor(options: BunDocsIndexAdapterOptions) {
    this.cache = options.cache;
    this.fetchClient = options.fetchClient;
    this.now = options.now ?? (() => new Date().toISOString());
    this.ttlMs = options.ttlMs ?? DEFAULT_BUN_DOCS_TTL_MS;
  }

  async listPages(topic?: BunDocsTopic): Promise<BunDocsIndexResult> {
    const resolved = await resolveWithCacheFallback({
      cache: this.cache,
      key: BUN_DOCS_INDEX_URL,
      sourceType: "bun-docs",
      sourceUrl: BUN_DOCS_INDEX_URL,
      now: this.now(),
      ttlMs: this.ttlMs,
      fetchFresh: async () => {
        const fetched = await this.fetchClient.fetchText(BUN_DOCS_INDEX_URL);

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

    const pages = parseBunDocsIndex(resolved.content, resolved.entry.fetchedAt);

    return {
      ok: true,
      pages: topic === undefined ? pages : pages.filter((page) => page.topic === topic),
      sourceUrl: BUN_DOCS_INDEX_URL,
      fetchedAt: resolved.entry.fetchedAt,
      cacheStatus: resolved.cacheStatus,
      confidence: resolved.confidence,
      warnings: resolved.warnings
    };
  }
}
