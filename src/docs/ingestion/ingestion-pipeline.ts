import type { ResponseWarning } from "../../shared/contracts";
import { createStructuredError, type StructuredError } from "../../shared/errors";
import type { EmbeddingProvider } from "../embeddings/provider";
import { bunDocsSourcePack } from "../sources/bun-source-pack";
import { BUN_DOCS_PRIMARY_INDEX_URL, BunDocsDiscoveryClient } from "../sources/bun-docs-discovery";
import type { DocsSourcePack } from "../sources/source-pack";
import type { DocChunk, RemoteDocsStorage } from "../storage/docs-storage";
import { chunkDocsPage } from "./chunking";

export interface IngestionSummary {
  readonly pagesDiscovered: number;
  readonly pagesStored: number;
  readonly pagesChanged: number;
  readonly pagesUnchanged: number;
  readonly chunksStored: number;
  readonly chunksReused: number;
  readonly embeddingsCreated: number;
  readonly embeddingsReused: number;
  readonly warnings: readonly ResponseWarning[];
}

export interface IngestionSuccess {
  readonly ok: true;
  readonly summary: IngestionSummary;
}

export interface IngestionFailure {
  readonly ok: false;
  readonly error: StructuredError;
  readonly summary: IngestionSummary;
}

export type IngestionResult = IngestionSuccess | IngestionFailure;

export interface BunDocsIngestionPipelineOptions {
  readonly storage: RemoteDocsStorage;
  readonly discoveryClient: BunDocsDiscoveryClient;
  readonly embeddingProvider: EmbeddingProvider;
  readonly sourcePack?: DocsSourcePack;
  readonly now?: () => string;
}

function emptySummary(): IngestionSummary {
  return {
    pagesDiscovered: 0,
    pagesStored: 0,
    pagesChanged: 0,
    pagesUnchanged: 0,
    chunksStored: 0,
    chunksReused: 0,
    embeddingsCreated: 0,
    embeddingsReused: 0,
    warnings: []
  };
}

function mergeSummary(left: IngestionSummary, right: IngestionSummary): IngestionSummary {
  return {
    pagesDiscovered: left.pagesDiscovered + right.pagesDiscovered,
    pagesStored: left.pagesStored + right.pagesStored,
    pagesChanged: left.pagesChanged + right.pagesChanged,
    pagesUnchanged: left.pagesUnchanged + right.pagesUnchanged,
    chunksStored: left.chunksStored + right.chunksStored,
    chunksReused: left.chunksReused + right.chunksReused,
    embeddingsCreated: left.embeddingsCreated + right.embeddingsCreated,
    embeddingsReused: left.embeddingsReused + right.embeddingsReused,
    warnings: [...left.warnings, ...right.warnings]
  };
}

function withWarnings(summary: IngestionSummary, warnings: readonly ResponseWarning[]): IngestionSummary {
  return {
    ...summary,
    warnings: [...summary.warnings, ...warnings]
  };
}

function addSeconds(isoTimestamp: string, seconds: number): string {
  return new Date(Date.parse(isoTimestamp) + seconds * 1000).toISOString();
}

export class BunDocsIngestionPipeline {
  private readonly storage: RemoteDocsStorage;
  private readonly discoveryClient: BunDocsDiscoveryClient;
  private readonly embeddingProvider: EmbeddingProvider;
  private readonly sourcePack: DocsSourcePack;
  private readonly now: () => string;

  constructor(options: BunDocsIngestionPipelineOptions) {
    this.storage = options.storage;
    this.discoveryClient = options.discoveryClient;
    this.embeddingProvider = options.embeddingProvider;
    this.sourcePack = options.sourcePack ?? bunDocsSourcePack;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async ingestFromIndex(options: { readonly limit?: number } = {}): Promise<IngestionResult> {
    const discovered = await this.discoveryClient.discoverPages(BUN_DOCS_PRIMARY_INDEX_URL);

    if (!discovered.ok) {
      return {
        ok: false,
        error: discovered.error,
        summary: emptySummary()
      };
    }

    const pages = options.limit === undefined ? discovered.pages : discovered.pages.slice(0, options.limit);
    let summary = withWarnings(
      {
        ...emptySummary(),
        pagesDiscovered: discovered.pages.length
      },
      discovered.warnings
    );

    for (const page of pages) {
      const result = await this.ingestPage(page.url);
      summary = mergeSummary(summary, result.summary);

      if (!result.ok) {
        return {
          ok: false,
          error: result.error,
          summary
        };
      }
    }

    return {
      ok: true,
      summary
    };
  }

  async ingestPage(url: string): Promise<IngestionResult> {
    const allowed = this.sourcePack.checkUrl(url);

    if (!allowed.allowed) {
      return {
        ok: false,
        error: allowed.error,
        summary: emptySummary()
      };
    }

    if (allowed.urlKind !== "page") {
      return {
        ok: false,
        error: createStructuredError("disallowed_source", "Bun docs ingestion only accepts page URLs.", {
          sourceUrl: allowed.url.href,
          expectedKind: "page",
          actualKind: allowed.urlKind
        }),
        summary: emptySummary()
      };
    }

    await this.ensureSource();

    const fetched = await this.discoveryClient.fetchPage(allowed.url.href);

    if (!fetched.ok) {
      return {
        ok: false,
        error: fetched.error,
        summary: emptySummary()
      };
    }

    const existingPage = await this.storage.getPageByCanonicalUrl(this.sourcePack.sourceId, fetched.canonicalUrl);
    const pageChanged = existingPage?.contentHash !== fetched.contentHash;
    const page = await this.storage.upsertPage({
      sourceId: this.sourcePack.sourceId,
      url: fetched.url,
      canonicalUrl: fetched.canonicalUrl,
      title: fetched.title,
      content: fetched.content,
      contentHash: fetched.contentHash,
      httpStatus: fetched.httpStatus,
      fetchedAt: fetched.fetchedAt,
      indexedAt: this.now(),
      expiresAt: addSeconds(fetched.fetchedAt, this.sourcePack.refreshPolicy.defaultTtlSeconds)
    });
    let summary: IngestionSummary = {
      ...emptySummary(),
      pagesStored: 1,
      pagesChanged: pageChanged ? 1 : 0,
      pagesUnchanged: pageChanged ? 0 : 1
    };
    let chunks: readonly DocChunk[];
    const existingChunks = pageChanged ? [] : await this.storage.getChunksForPage(page.id);

    if (pageChanged || existingChunks.length === 0) {
      await this.storage.deleteChunksForPage(page.id);
      const chunked = chunkDocsPage({
        sourceId: this.sourcePack.sourceId,
        pageId: String(page.id),
        title: fetched.title,
        url: fetched.canonicalUrl,
        content: fetched.content,
        chunking: this.sourcePack.chunking
      });
      chunks = await this.storage.insertChunks({
        sourceId: this.sourcePack.sourceId,
        pageId: page.id,
        chunks: chunked.chunks.map((chunk) => ({
          url: chunk.url,
          title: chunk.title,
          headingPath: chunk.headingPath,
          chunkIndex: chunk.chunkIndex,
          content: chunk.content,
          contentHash: chunk.contentHash,
          tokenEstimate: chunk.tokenEstimate
        }))
      });
      summary = {
        ...summary,
        chunksStored: chunks.length
      };
    } else {
      chunks = existingChunks;
      summary = {
        ...summary,
        chunksReused: chunks.length
      };
    }

    const embeddingResult = await this.embedMissingChunks(chunks);
    summary = mergeSummary(summary, embeddingResult.summary);

    if (!embeddingResult.ok) {
      return {
        ok: false,
        error: embeddingResult.error,
        summary
      };
    }

    return {
      ok: true,
      summary
    };
  }

  private async ensureSource(): Promise<void> {
    await this.storage.upsertSource({
      sourceId: this.sourcePack.sourceId,
      displayName: this.sourcePack.displayName,
      enabled: this.sourcePack.enabled,
      allowedUrlPatterns: this.sourcePack.allowedUrlPatterns,
      defaultTtlSeconds: this.sourcePack.refreshPolicy.defaultTtlSeconds
    });
  }

  private async embedMissingChunks(chunks: readonly DocChunk[]): Promise<IngestionResult> {
    const chunksNeedingEmbeddings: DocChunk[] = [];
    let embeddingsReused = 0;

    for (const chunk of chunks) {
      const existingEmbedding = await this.storage.getEmbeddingForChunk({
        chunkId: chunk.id,
        provider: this.embeddingProvider.metadata.provider,
        model: this.embeddingProvider.metadata.model,
        embeddingVersion: this.embeddingProvider.metadata.embeddingVersion
      });

      if (existingEmbedding === null) {
        chunksNeedingEmbeddings.push(chunk);
      } else {
        embeddingsReused += 1;
      }
    }

    if (chunksNeedingEmbeddings.length === 0) {
      return {
        ok: true,
        summary: {
          ...emptySummary(),
          embeddingsReused
        }
      };
    }

    const embedded = await this.embeddingProvider.embedTexts({
      texts: chunksNeedingEmbeddings.map((chunk) => chunk.content)
    });

    if (!embedded.ok) {
      return {
        ok: false,
        error: embedded.error,
        summary: {
          ...emptySummary(),
          embeddingsReused
        }
      };
    }

    for (const embedding of embedded.embeddings) {
      const chunk = chunksNeedingEmbeddings[embedding.index];

      if (chunk === undefined) {
        continue;
      }

      await this.storage.insertEmbedding({
        chunkId: chunk.id,
        provider: embedded.metadata.provider,
        model: embedded.metadata.model,
        embeddingVersion: embedded.metadata.embeddingVersion,
        dimensions: embedded.metadata.dimensions,
        embedding: embedding.vector
      });
    }

    return {
      ok: true,
      summary: {
        ...emptySummary(),
        embeddingsCreated: embedded.embeddings.length,
        embeddingsReused
      }
    };
  }
}
