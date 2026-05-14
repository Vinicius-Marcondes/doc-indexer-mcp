import { computeContentHash } from "../../cache/sqlite-cache";
import type { ResponseWarning } from "../../shared/contracts";
import { createStructuredError, type StructuredError } from "../../shared/errors";
import { bunDocsSourcePack, revalidateSourceRedirect } from "./bun-source-pack";
import { normalizeBunDocsContent } from "./bun-docs-normalizer";
import type { DocsSourcePack, DocsSourceUrlAllowed } from "./source-pack";

export type DocsSourceFetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export const BUN_DOCS_PRIMARY_INDEX_URL = "https://bun.com/docs/llms.txt";

export interface BunDocsDiscoveredPage {
  readonly sourceId: "bun";
  readonly title: string;
  readonly url: string;
  readonly canonicalUrl: string;
}

export interface BunDocsDiscoverySuccess {
  readonly ok: true;
  readonly sourceId: "bun";
  readonly indexUrl: string;
  readonly pages: readonly BunDocsDiscoveredPage[];
  readonly warnings: readonly ResponseWarning[];
  readonly fetchedAt: string;
  readonly httpStatus: number;
  readonly contentHash: string;
}

export interface BunDocsPageFetchSuccess {
  readonly ok: true;
  readonly sourceId: "bun";
  readonly url: string;
  readonly canonicalUrl: string;
  readonly title: string;
  readonly content: string;
  readonly fetchedAt: string;
  readonly httpStatus: number;
  readonly contentHash: string;
}

export interface BunDocsSourceFailure {
  readonly ok: false;
  readonly error: StructuredError;
}

export type BunDocsDiscoveryResult = BunDocsDiscoverySuccess | BunDocsSourceFailure;
export type BunDocsPageFetchResult = BunDocsPageFetchSuccess | BunDocsSourceFailure;

export interface BunDocsDiscoveryClientOptions {
  readonly sourcePack?: DocsSourcePack;
  readonly fetchImpl?: DocsSourceFetchLike;
  readonly now?: () => string;
}

interface FetchedDocsText {
  readonly body: string;
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly status: number;
  readonly contentType: string | undefined;
  readonly fetchedAt: string;
}

function fetchFailedError(sourceUrl: string, error: unknown): StructuredError {
  const reason = error instanceof Error && error.message.length > 0 ? error.message : "unknown fetch failure";

  return createStructuredError("fetch_failed", "Source fetch failed.", {
    sourceUrl,
    reason
  });
}

function statusFailedError(sourceUrl: string, response: Response): StructuredError {
  return createStructuredError("fetch_failed", "Source fetch failed with a non-success HTTP status.", {
    sourceUrl,
    status: response.status,
    statusText: response.statusText
  });
}

function disallowedUrlWarning(url: string, indexUrl: string): ResponseWarning {
  return {
    id: "disallowed_docs_url",
    title: "Disallowed docs URL skipped",
    detail: `The Bun docs index referenced a URL outside the configured source policy: ${url}`,
    evidence: [url],
    sources: [indexUrl]
  };
}

function normalizeCandidateUrl(url: string): string {
  return url.replace(/[),.;]+$/u, "");
}

function addPageCandidate(
  pages: BunDocsDiscoveredPage[],
  warnings: ResponseWarning[],
  seen: Set<string>,
  sourcePack: DocsSourcePack,
  indexUrl: string,
  title: string,
  candidateUrl: string
): void {
  const normalizedUrl = normalizeCandidateUrl(candidateUrl);
  const allowed = sourcePack.checkUrl(normalizedUrl);

  if (!allowed.allowed) {
    warnings.push(disallowedUrlWarning(normalizedUrl, indexUrl));
    return;
  }

  if (allowed.urlKind !== "page" || seen.has(allowed.url.href)) {
    return;
  }

  seen.add(allowed.url.href);
  pages.push({
    sourceId: "bun",
    title: title.trim().replace(/^[-*\s]+/u, "") || "Bun docs page",
    url: allowed.url.href,
    canonicalUrl: allowed.url.href
  });
}

export function parseBunDocsIndexForSourcePack(
  content: string,
  sourcePack: DocsSourcePack,
  indexUrl: string
): { pages: readonly BunDocsDiscoveredPage[]; warnings: readonly ResponseWarning[] } {
  const pages: BunDocsDiscoveredPage[] = [];
  const warnings: ResponseWarning[] = [];
  const seen = new Set<string>();
  const markdownLinkPattern = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/giu;
  const plainUrlPattern = /([^:\n]+):\s*(https?:\/\/\S+)/iu;

  for (const line of content.split(/\r?\n/u)) {
    let matchedMarkdown = false;

    for (const match of line.matchAll(markdownLinkPattern)) {
      matchedMarkdown = true;
      addPageCandidate(pages, warnings, seen, sourcePack, indexUrl, match[1] ?? "Bun docs page", match[2] ?? "");
    }

    if (matchedMarkdown) {
      continue;
    }

    const plainUrlMatch = plainUrlPattern.exec(line);

    if (plainUrlMatch !== null) {
      addPageCandidate(
        pages,
        warnings,
        seen,
        sourcePack,
        indexUrl,
        plainUrlMatch[1] ?? "Bun docs page",
        plainUrlMatch[2] ?? ""
      );
    }
  }

  return { pages, warnings };
}

export class BunDocsDiscoveryClient {
  private readonly sourcePack: DocsSourcePack;
  private readonly fetchImpl: DocsSourceFetchLike;
  private readonly now: () => string;

  constructor(options: BunDocsDiscoveryClientOptions = {}) {
    this.sourcePack = options.sourcePack ?? bunDocsSourcePack;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async discoverPages(indexUrl = BUN_DOCS_PRIMARY_INDEX_URL): Promise<BunDocsDiscoveryResult> {
    const fetched = await this.fetchAllowedText(indexUrl, "index");

    if (!fetched.ok) {
      return fetched;
    }

    const parsed = parseBunDocsIndexForSourcePack(fetched.body, this.sourcePack, fetched.finalUrl);

    return {
      ok: true,
      sourceId: "bun",
      indexUrl: fetched.finalUrl,
      pages: parsed.pages,
      warnings: parsed.warnings,
      fetchedAt: fetched.fetchedAt,
      httpStatus: fetched.status,
      contentHash: computeContentHash(fetched.body)
    };
  }

  async fetchPage(url: string): Promise<BunDocsPageFetchResult> {
    const fetched = await this.fetchAllowedText(url, "page");

    if (!fetched.ok) {
      return fetched;
    }

    const normalized = normalizeBunDocsContent({
      url: fetched.finalUrl,
      body: fetched.body,
      ...(fetched.contentType === undefined ? {} : { contentType: fetched.contentType })
    });

    return {
      ok: true,
      sourceId: "bun",
      url: fetched.requestedUrl,
      canonicalUrl: fetched.finalUrl,
      title: normalized.title,
      content: normalized.content,
      fetchedAt: fetched.fetchedAt,
      httpStatus: fetched.status,
      contentHash: computeContentHash(normalized.content)
    };
  }

  private async fetchAllowedText(
    inputUrl: string,
    expectedKind: DocsSourceUrlAllowed["urlKind"]
  ): Promise<(FetchedDocsText & { ok: true }) | BunDocsSourceFailure> {
    const allowed = this.sourcePack.checkUrl(inputUrl);

    if (!allowed.allowed) {
      return {
        ok: false,
        error: allowed.error
      };
    }

    if (allowed.urlKind !== expectedKind) {
      return {
        ok: false,
        error: createStructuredError("disallowed_source", "Source URL is not valid for this Bun docs operation.", {
          sourceUrl: inputUrl,
          expectedKind,
          actualKind: allowed.urlKind
        })
      };
    }

    try {
      const response = await this.fetchImpl(allowed.url.href, { redirect: "follow" });
      const finalUrl = response.url.length > 0 ? response.url : allowed.url.href;
      const finalAllowed = revalidateSourceRedirect(this.sourcePack, allowed.url, finalUrl);

      if (!finalAllowed.allowed || finalAllowed.urlKind !== expectedKind) {
        return {
          ok: false,
          error: finalAllowed.allowed
            ? createStructuredError("disallowed_source", "Redirect target is not valid for this Bun docs operation.", {
                sourceUrl: finalAllowed.url.href,
                expectedKind,
                actualKind: finalAllowed.urlKind
              })
            : finalAllowed.error
        };
      }

      if (!response.ok) {
        return {
          ok: false,
          error: statusFailedError(allowed.url.href, response)
        };
      }

      return {
        ok: true,
        body: await response.text(),
        requestedUrl: allowed.url.href,
        finalUrl: finalAllowed.url.href,
        status: response.status,
        contentType: response.headers.get("content-type") ?? undefined,
        fetchedAt: this.now()
      };
    } catch (error) {
      return {
        ok: false,
        error: fetchFailedError(allowed.url.href, error)
      };
    }
  }
}
