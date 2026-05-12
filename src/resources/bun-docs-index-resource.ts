import { BUN_DOCS_INDEX_URL, type BunDocsIndexAdapter, type BunDocsIndexPage } from "../sources/bun-docs-index";
import type { CacheStatus, Confidence, ResponseWarning, SourceCitation } from "../shared/contracts";
import type { StructuredError } from "../shared/errors";

export const BUN_DOCS_INDEX_RESOURCE_URI = "bun-docs://index";

export interface ResourceDescriptor {
  readonly uri: string;
  readonly name: string;
  readonly description: string;
  readonly mimeType: "application/json";
}

export const bunDocsIndexResource: ResourceDescriptor = {
  uri: BUN_DOCS_INDEX_RESOURCE_URI,
  name: "bun-docs-index",
  description: "Cached official Bun documentation index.",
  mimeType: "application/json"
};

export interface BunDocsIndexResourcePage {
  readonly title: string;
  readonly url: string;
  readonly topic: BunDocsIndexPage["topic"];
  readonly sourceUrl: string;
  readonly fetchedAt: string;
}

export interface BunDocsIndexResourceSuccess {
  readonly ok: true;
  readonly uri: typeof BUN_DOCS_INDEX_RESOURCE_URI;
  readonly fetchedAt: string;
  readonly sourceUrl: string;
  readonly pages: BunDocsIndexResourcePage[];
  readonly cacheStatus: Extract<CacheStatus, "fresh" | "stale">;
  readonly confidence: Confidence;
  readonly sources: SourceCitation[];
  readonly warnings: ResponseWarning[];
}

export interface BunDocsIndexResourceFailure {
  readonly ok: false;
  readonly uri: typeof BUN_DOCS_INDEX_RESOURCE_URI;
  readonly error: StructuredError;
}

export type BunDocsIndexResourceResult = BunDocsIndexResourceSuccess | BunDocsIndexResourceFailure;

export interface BunDocsIndexResourceDependencies {
  readonly adapter: BunDocsIndexAdapter;
}

export function listBunDocsIndexResources(): readonly ResourceDescriptor[] {
  return [bunDocsIndexResource];
}

function sourceFor(fetchedAt: string): SourceCitation {
  return {
    title: "Bun docs index",
    url: BUN_DOCS_INDEX_URL,
    sourceType: "bun-docs",
    fetchedAt
  };
}

export async function readBunDocsIndexResource(
  dependencies: BunDocsIndexResourceDependencies
): Promise<BunDocsIndexResourceResult> {
  const index = await dependencies.adapter.listPages();

  if (!index.ok) {
    return {
      ok: false,
      uri: BUN_DOCS_INDEX_RESOURCE_URI,
      error: index.error
    };
  }

  return {
    ok: true,
    uri: BUN_DOCS_INDEX_RESOURCE_URI,
    fetchedAt: index.fetchedAt,
    sourceUrl: index.sourceUrl,
    pages: index.pages.map((page) => ({
      title: page.title,
      url: page.url,
      topic: page.topic,
      sourceUrl: page.sourceUrl,
      fetchedAt: page.fetchedAt
    })),
    cacheStatus: index.cacheStatus,
    confidence: index.confidence,
    sources: [sourceFor(index.fetchedAt)],
    warnings: index.warnings
  };
}
