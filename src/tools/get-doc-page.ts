import * as z from "zod/v4";
import { createInvalidInputError, createStructuredError, type StructuredError } from "../shared/errors";
import { defaultDocsSourceRegistry } from "../docs/sources/bun-source-pack";
import type { DocsSourceRegistry } from "../docs/sources/registry";
import type { EnqueueRefreshJobInput, EnqueueRefreshJobResult } from "../docs/refresh/refresh-queue";
import {
  missingDocsPage,
  storedDocsPageOutput,
  type DocsPageStore,
  type MissingDocsPageOutput,
  type StoredDocsPageOutput
} from "../resources/docs-resources";

export const getDocPageInputSchema = z
  .object({
    sourceId: z.string().min(1).optional(),
    url: z.string().min(1),
    forceRefresh: z.boolean().optional()
  })
  .strict();

export interface GetDocPageDependencies {
  readonly pageStore?: DocsPageStore;
  readonly refreshQueue?: {
    readonly enqueue: (input: EnqueueRefreshJobInput) => Promise<EnqueueRefreshJobResult>;
  };
  readonly sourceRegistry?: DocsSourceRegistry;
  readonly now: () => string;
}

export interface GetDocPageFailure {
  readonly ok: false;
  readonly error: StructuredError;
}

export type GetDocPageResult = StoredDocsPageOutput | MissingDocsPageOutput | GetDocPageFailure;

function missingStoreError(): StructuredError {
  return createStructuredError("internal_error", "Docs page store is not configured.");
}

async function enqueuePageRefresh(
  dependencies: GetDocPageDependencies,
  input: EnqueueRefreshJobInput
): Promise<boolean> {
  if (dependencies.refreshQueue === undefined) {
    return false;
  }

  try {
    const result = await dependencies.refreshQueue.enqueue(input);
    return result.status === "queued";
  } catch {
    return false;
  }
}

export async function getDocPage(input: unknown, dependencies: GetDocPageDependencies): Promise<GetDocPageResult> {
  const parsed = getDocPageInputSchema.safeParse(input);

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

  const checkedUrl = sourcePack.checkUrl(parsed.data.url);

  if (!checkedUrl.allowed || checkedUrl.sourceId !== sourceId || checkedUrl.urlKind !== "page") {
    return {
      ok: false,
      error: checkedUrl.allowed
        ? createStructuredError("disallowed_source", "URL is not allowed for the requested docs source.", {
            sourceId,
            url: parsed.data.url
          })
        : checkedUrl.error
    };
  }

  if (dependencies.pageStore === undefined) {
    return {
      ok: false,
      error: missingStoreError()
    };
  }

  const canonicalUrl = checkedUrl.url.href;
  const page = await dependencies.pageStore.getPageByUrl({ sourceId, url: canonicalUrl });

  if (page === null) {
    const refreshQueued = await enqueuePageRefresh(dependencies, {
      sourceId,
      url: canonicalUrl,
      jobType: "page",
      reason: parsed.data.forceRefresh === true ? "manual" : "missing_content",
      prioritySignals: {
        staleHitCount: 1
      }
    });

    return {
      ...missingDocsPage({
        sourceId,
        url: canonicalUrl,
        generatedAt: dependencies.now()
      }),
      refreshQueued
    };
  }

  const chunks = await dependencies.pageStore.getChunksForPage(page.id);
  const output = storedDocsPageOutput({
    page,
    chunks,
    generatedAt: dependencies.now()
  });

  if (output.freshness !== "stale" && parsed.data.forceRefresh !== true) {
    return output;
  }

  const refreshQueued = await enqueuePageRefresh(dependencies, {
    sourceId,
    url: canonicalUrl,
    jobType: "page",
    reason: parsed.data.forceRefresh === true ? "manual" : "stale_content",
    prioritySignals: {
      staleHitCount: output.freshness === "stale" ? 1 : 0
    }
  });

  return {
    ...output,
    refreshQueued
  };
}
