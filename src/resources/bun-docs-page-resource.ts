import * as z from "zod/v4";
import type { BunDocsPageAdapter } from "../sources/bun-docs-page";
import type { CacheStatus, Confidence, ResponseWarning, SourceCitation } from "../shared/contracts";
import { createInvalidInputError, type StructuredError } from "../shared/errors";

export const BUN_DOCS_PAGE_RESOURCE_URI_TEMPLATE = "bun-docs://page/{slug}";

export interface ResourceTemplateDescriptor {
  readonly uriTemplate: string;
  readonly name: string;
  readonly description: string;
  readonly mimeType: "application/json";
}

export const bunDocsPageResourceTemplate: ResourceTemplateDescriptor = {
  uriTemplate: BUN_DOCS_PAGE_RESOURCE_URI_TEMPLATE,
  name: "bun-docs-page",
  description: "Cached official Bun documentation page resolved from the Bun docs index.",
  mimeType: "application/json"
};

const readPageResourceInputSchema = z
  .object({
    slug: z.string().min(1)
  })
  .strict();

export interface BunDocsPageResourceSuccess {
  readonly ok: true;
  readonly uri: string;
  readonly uriTemplate: typeof BUN_DOCS_PAGE_RESOURCE_URI_TEMPLATE;
  readonly slug: string;
  readonly title: string;
  readonly url: string;
  readonly content: string;
  readonly fetchedAt: string;
  readonly contentHash: string;
  readonly cacheStatus: Extract<CacheStatus, "fresh" | "stale">;
  readonly confidence: Confidence;
  readonly sources: SourceCitation[];
  readonly warnings: ResponseWarning[];
}

export interface BunDocsPageResourceFailure {
  readonly ok: false;
  readonly uriTemplate: typeof BUN_DOCS_PAGE_RESOURCE_URI_TEMPLATE;
  readonly error: StructuredError;
}

export type BunDocsPageResourceResult = BunDocsPageResourceSuccess | BunDocsPageResourceFailure;

export interface BunDocsPageResourceDependencies {
  readonly adapter: BunDocsPageAdapter;
}

export function listBunDocsPageResources(): readonly ResourceTemplateDescriptor[] {
  return [bunDocsPageResourceTemplate];
}

function sourceFor(page: {
  readonly title: string;
  readonly url: string;
  readonly fetchedAt: string;
  readonly contentHash: string;
}): SourceCitation {
  return {
    title: page.title,
    url: page.url,
    sourceType: "bun-docs",
    fetchedAt: page.fetchedAt,
    contentHash: page.contentHash
  };
}

export async function readBunDocsPageResource(
  input: unknown,
  dependencies: BunDocsPageResourceDependencies
): Promise<BunDocsPageResourceResult> {
  const parsed = readPageResourceInputSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      uriTemplate: BUN_DOCS_PAGE_RESOURCE_URI_TEMPLATE,
      error: createInvalidInputError(parsed.error)
    };
  }

  const page = await dependencies.adapter.getPage(parsed.data.slug);

  if (!page.ok) {
    return {
      ok: false,
      uriTemplate: BUN_DOCS_PAGE_RESOURCE_URI_TEMPLATE,
      error: page.error
    };
  }

  return {
    ok: true,
    uri: `bun-docs://page/${page.slug}`,
    uriTemplate: BUN_DOCS_PAGE_RESOURCE_URI_TEMPLATE,
    slug: page.slug,
    title: page.title,
    url: page.url,
    content: page.content,
    fetchedAt: page.fetchedAt,
    contentHash: page.contentHash,
    cacheStatus: page.cacheStatus,
    confidence: page.confidence,
    sources: [sourceFor(page)],
    warnings: page.warnings
  };
}
