import { createNoEvidenceError, createStructuredError, type StructuredError } from "../shared/errors";
import type { SourceCitation } from "../shared/contracts";
import type { DocsSourceRegistry } from "../docs/sources/registry";

export const DOCS_SOURCES_RESOURCE_URI = "docs://sources";
export const DOCS_PAGE_RESOURCE_URI_TEMPLATE = "docs://page/{sourceId}/{pageId}";
export const DOCS_CHUNK_RESOURCE_URI_TEMPLATE = "docs://chunk/{sourceId}/{chunkId}";

export const docsSourcesResource = {
  name: "docs-sources",
  description: "List enabled remote documentation source packs and indexed counts.",
  mimeType: "application/json" as const,
  uri: DOCS_SOURCES_RESOURCE_URI
};

export const docsPageResourceTemplate = {
  name: "docs-page",
  description: "Read one stored documentation page by source and internal page ID.",
  mimeType: "application/json" as const,
  uriTemplate: DOCS_PAGE_RESOURCE_URI_TEMPLATE
};

export const docsChunkResourceTemplate = {
  name: "docs-chunk",
  description: "Read one stored documentation chunk by source and internal chunk ID.",
  mimeType: "application/json" as const,
  uriTemplate: DOCS_CHUNK_RESOURCE_URI_TEMPLATE
};

export type DocsContentFreshness = "fresh" | "stale" | "missing" | "refreshing";

export interface StoredDocsSourceStats {
  readonly sourceId: string;
  readonly displayName: string;
  readonly enabled: boolean;
  readonly allowedUrlPatterns: readonly string[];
  readonly defaultTtlSeconds: number;
  readonly pageCount: number;
  readonly chunkCount: number;
}

export interface StoredDocsPage {
  readonly id: number;
  readonly sourceId: string;
  readonly url: string;
  readonly canonicalUrl: string;
  readonly title: string;
  readonly content: string;
  readonly contentHash: string;
  readonly fetchedAt: string;
  readonly indexedAt: string;
  readonly expiresAt: string | null;
  readonly tombstonedAt: string | null;
  readonly tombstoneReason: string | null;
}

export interface StoredDocsChunk {
  readonly id: number;
  readonly sourceId: string;
  readonly pageId: number;
  readonly url: string;
  readonly title: string;
  readonly headingPath: readonly string[];
  readonly chunkIndex: number;
  readonly content: string;
  readonly contentHash: string;
  readonly tokenEstimate: number;
  readonly previousChunkId: number | null;
  readonly nextChunkId: number | null;
}

export interface DocsPageStore {
  readonly listSourceStats: () => Promise<readonly StoredDocsSourceStats[]>;
  readonly getPageByUrl: (input: { readonly sourceId: string; readonly url: string }) => Promise<StoredDocsPage | null>;
  readonly getPageById: (input: { readonly sourceId: string; readonly pageId: number }) => Promise<StoredDocsPage | null>;
  readonly getChunksForPage: (pageId: number) => Promise<readonly StoredDocsChunk[]>;
  readonly getChunkById: (input: { readonly sourceId: string; readonly chunkId: number }) => Promise<StoredDocsChunk | null>;
}

export interface DocsResourceDependencies {
  readonly pageStore?: DocsPageStore;
  readonly sourceRegistry: DocsSourceRegistry;
  readonly now: () => string;
}

export interface DocsResourceFailure {
  readonly ok: false;
  readonly error: StructuredError;
}

export interface DocsResourceWarning {
  readonly code: "missing_page" | "stale_page" | "tombstoned_page";
  readonly message: string;
}

export interface StoredDocsChunkOutput {
  readonly chunkId: number;
  readonly pageId: number;
  readonly title: string;
  readonly url: string;
  readonly headingPath: readonly string[];
  readonly chunkIndex: number;
  readonly content: string;
  readonly contentHash: string;
  readonly tokenEstimate: number;
  readonly previousChunkId: number | null;
  readonly nextChunkId: number | null;
}

export interface StoredDocsPageOutput {
  readonly ok: true;
  readonly generatedAt: string;
  readonly sourceId: string;
  readonly pageId: number;
  readonly url: string;
  readonly canonicalUrl: string;
  readonly title: string;
  readonly content: string;
  readonly chunks: readonly StoredDocsChunkOutput[];
  readonly fetchedAt: string;
  readonly indexedAt: string;
  readonly contentHash: string;
  readonly freshness: DocsContentFreshness;
  readonly refreshQueued: false;
  readonly refreshReason?: "stale_content";
  readonly warnings: readonly DocsResourceWarning[];
  readonly sources: readonly SourceCitation[];
}

export interface MissingDocsPageOutput {
  readonly ok: true;
  readonly generatedAt: string;
  readonly sourceId: string;
  readonly url: string;
  readonly title: null;
  readonly content: null;
  readonly chunks: readonly [];
  readonly fetchedAt: null;
  readonly indexedAt: null;
  readonly contentHash: null;
  readonly freshness: "missing";
  readonly refreshQueued: false;
  readonly refreshReason: "missing_content";
  readonly warnings: readonly DocsResourceWarning[];
  readonly sources: readonly [];
}

export interface DocsSourcesResourceSuccess {
  readonly ok: true;
  readonly generatedAt: string;
  readonly sources: ReadonlyArray<{
    readonly sourceId: string;
    readonly displayName: string;
    readonly enabled: boolean;
    readonly allowedHosts: readonly string[];
    readonly pageCount: number;
    readonly chunkCount: number;
  }>;
}

export interface DocsChunkResourceSuccess {
  readonly ok: true;
  readonly generatedAt: string;
  readonly sourceId: string;
  readonly chunkId: number;
  readonly pageId: number;
  readonly title: string;
  readonly url: string;
  readonly headingPath: readonly string[];
  readonly chunkIndex: number;
  readonly content: string;
  readonly contentHash: string;
  readonly tokenEstimate: number;
  readonly previousChunkId: number | null;
  readonly nextChunkId: number | null;
  readonly sources: readonly SourceCitation[];
}

export type DocsSourcesResourceResult = DocsSourcesResourceSuccess | DocsResourceFailure;
export type DocsPageResourceResult = StoredDocsPageOutput | DocsResourceFailure;
export type DocsChunkResourceResult = DocsChunkResourceSuccess | DocsResourceFailure;

function sourceTypeFor(sourceId: string): SourceCitation["sourceType"] {
  if (sourceId === "bun") {
    return "bun-docs";
  }

  return "bun-docs";
}

function validateSource(sourceId: string, sourceRegistry: DocsSourceRegistry): StructuredError | null {
  const sourcePack = sourceRegistry.get(sourceId);

  if (sourcePack === undefined || !sourcePack.enabled) {
    return createStructuredError("disallowed_source", "Docs source is not enabled for this MCP server.", {
      sourceId,
      allowedSourceIds: sourceRegistry.list().map((source) => source.sourceId)
    });
  }

  return null;
}

function parsePositiveId(raw: string, name: string): { ok: true; id: number } | { ok: false; error: StructuredError } {
  if (!/^[1-9][0-9]*$/u.test(raw)) {
    return {
      ok: false,
      error: createStructuredError("invalid_input", `${name} must be a positive integer.`, {
        [name]: raw
      })
    };
  }

  const id = Number(raw);

  if (!Number.isSafeInteger(id)) {
    return {
      ok: false,
      error: createStructuredError("invalid_input", `${name} must be a safe integer.`, {
        [name]: raw
      })
    };
  }

  return { ok: true, id };
}

function missingStoreError(): DocsResourceFailure {
  return {
    ok: false,
    error: createStructuredError("internal_error", "Docs page store is not configured.")
  };
}

function pageFreshness(page: StoredDocsPage, now: string): DocsContentFreshness {
  if (page.tombstonedAt !== null) {
    return "missing";
  }

  if (page.expiresAt === null) {
    return "fresh";
  }

  const expiresAtMs = Date.parse(page.expiresAt);
  const nowMs = Date.parse(now);

  if (Number.isNaN(expiresAtMs) || Number.isNaN(nowMs)) {
    return "stale";
  }

  return expiresAtMs <= nowMs ? "stale" : "fresh";
}

function pageWarnings(page: StoredDocsPage, freshness: DocsContentFreshness): DocsResourceWarning[] {
  if (page.tombstonedAt !== null) {
    return [
      {
        code: "tombstoned_page",
        message: "Documentation page is tombstoned."
      }
    ];
  }

  if (freshness === "stale") {
    return [
      {
        code: "stale_page",
        message: "Stored documentation page is stale."
      }
    ];
  }

  return [];
}

function chunkOutput(chunk: StoredDocsChunk): StoredDocsChunkOutput {
  return {
    chunkId: chunk.id,
    pageId: chunk.pageId,
    title: chunk.title,
    url: chunk.url,
    headingPath: chunk.headingPath,
    chunkIndex: chunk.chunkIndex,
    content: chunk.content,
    contentHash: chunk.contentHash,
    tokenEstimate: chunk.tokenEstimate,
    previousChunkId: chunk.previousChunkId,
    nextChunkId: chunk.nextChunkId
  };
}

function pageSource(page: StoredDocsPage): SourceCitation {
  return {
    title: page.title,
    url: page.url,
    sourceType: sourceTypeFor(page.sourceId),
    fetchedAt: page.fetchedAt,
    contentHash: page.contentHash
  };
}

function chunkSource(chunk: StoredDocsChunk): SourceCitation {
  return {
    title: chunk.title,
    url: chunk.url,
    sourceType: sourceTypeFor(chunk.sourceId),
    fetchedAt: new Date(0).toISOString(),
    contentHash: chunk.contentHash
  };
}

export function missingDocsPage(input: {
  readonly sourceId: string;
  readonly url: string;
  readonly generatedAt: string;
}): MissingDocsPageOutput {
  return {
    ok: true,
    generatedAt: input.generatedAt,
    sourceId: input.sourceId,
    url: input.url,
    title: null,
    content: null,
    chunks: [],
    fetchedAt: null,
    indexedAt: null,
    contentHash: null,
    freshness: "missing",
    refreshQueued: false,
    refreshReason: "missing_content",
    warnings: [
      {
        code: "missing_page",
        message: "Allowed documentation page is not indexed yet."
      }
    ],
    sources: []
  };
}

export function storedDocsPageOutput(input: {
  readonly page: StoredDocsPage;
  readonly chunks: readonly StoredDocsChunk[];
  readonly generatedAt: string;
}): StoredDocsPageOutput {
  const freshness = pageFreshness(input.page, input.generatedAt);

  return {
    ok: true,
    generatedAt: input.generatedAt,
    sourceId: input.page.sourceId,
    pageId: input.page.id,
    url: input.page.url,
    canonicalUrl: input.page.canonicalUrl,
    title: input.page.title,
    content: input.page.content,
    chunks: input.chunks.map(chunkOutput),
    fetchedAt: input.page.fetchedAt,
    indexedAt: input.page.indexedAt,
    contentHash: input.page.contentHash,
    freshness,
    refreshQueued: false,
    ...(freshness === "stale" ? { refreshReason: "stale_content" as const } : {}),
    warnings: pageWarnings(input.page, freshness),
    sources: [pageSource(input.page)]
  };
}

export async function readDocsSourcesResource(
  dependencies: DocsResourceDependencies
): Promise<DocsSourcesResourceResult> {
  const stats = dependencies.pageStore === undefined ? [] : await dependencies.pageStore.listSourceStats();
  const statsBySourceId = new Map(stats.map((item) => [item.sourceId, item]));

  return {
    ok: true,
    generatedAt: dependencies.now(),
    sources: dependencies.sourceRegistry.list().map((sourcePack) => {
      const sourceStats = statsBySourceId.get(sourcePack.sourceId);

      return {
        sourceId: sourcePack.sourceId,
        displayName: sourcePack.displayName,
        enabled: sourcePack.enabled,
        allowedHosts: sourcePack.allowedHosts,
        pageCount: sourceStats?.pageCount ?? 0,
        chunkCount: sourceStats?.chunkCount ?? 0
      };
    })
  };
}

export async function readDocsPageResource(
  input: { readonly sourceId: string; readonly pageId: string },
  dependencies: DocsResourceDependencies
): Promise<DocsPageResourceResult> {
  const sourceError = validateSource(input.sourceId, dependencies.sourceRegistry);

  if (sourceError !== null) {
    return { ok: false, error: sourceError };
  }

  const parsedPageId = parsePositiveId(input.pageId, "pageId");

  if (!parsedPageId.ok) {
    return { ok: false, error: parsedPageId.error };
  }

  if (dependencies.pageStore === undefined) {
    return missingStoreError();
  }

  const page = await dependencies.pageStore.getPageById({
    sourceId: input.sourceId,
    pageId: parsedPageId.id
  });

  if (page === null) {
    return {
      ok: false,
      error: createNoEvidenceError({
        reason: "Stored documentation page was not found."
      })
    };
  }

  const chunks = await dependencies.pageStore.getChunksForPage(page.id);
  return storedDocsPageOutput({ page, chunks, generatedAt: dependencies.now() });
}

export async function readDocsChunkResource(
  input: { readonly sourceId: string; readonly chunkId: string },
  dependencies: DocsResourceDependencies
): Promise<DocsChunkResourceResult> {
  const sourceError = validateSource(input.sourceId, dependencies.sourceRegistry);

  if (sourceError !== null) {
    return { ok: false, error: sourceError };
  }

  const parsedChunkId = parsePositiveId(input.chunkId, "chunkId");

  if (!parsedChunkId.ok) {
    return { ok: false, error: parsedChunkId.error };
  }

  if (dependencies.pageStore === undefined) {
    return missingStoreError();
  }

  const chunk = await dependencies.pageStore.getChunkById({
    sourceId: input.sourceId,
    chunkId: parsedChunkId.id
  });

  if (chunk === null) {
    return {
      ok: false,
      error: createNoEvidenceError({
        reason: "Stored documentation chunk was not found."
      })
    };
  }

  return {
    ok: true,
    generatedAt: dependencies.now(),
    sourceId: chunk.sourceId,
    chunkId: chunk.id,
    pageId: chunk.pageId,
    title: chunk.title,
    url: chunk.url,
    headingPath: chunk.headingPath,
    chunkIndex: chunk.chunkIndex,
    content: chunk.content,
    contentHash: chunk.contentHash,
    tokenEstimate: chunk.tokenEstimate,
    previousChunkId: chunk.previousChunkId,
    nextChunkId: chunk.nextChunkId,
    sources: [chunkSource(chunk)]
  };
}
