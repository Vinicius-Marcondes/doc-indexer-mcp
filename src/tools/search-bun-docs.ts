import * as z from "zod/v4";
import type { BunDocsSearchAdapter, BunDocsSearchResult } from "../sources/bun-docs-search";
import type { BunDocsTopic } from "../sources/bun-docs-index";
import { createInvalidInputError, type StructuredError } from "../shared/errors";

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

const searchBunDocsInputSchema = z
  .object({
    query: z.string().min(1),
    topic: topicSchema.optional(),
    forceRefresh: z.boolean().optional()
  })
  .strict();

export interface SearchBunDocsDependencies {
  readonly adapter: BunDocsSearchAdapter;
}

export interface SearchBunDocsFailure {
  readonly ok: false;
  readonly error: StructuredError;
}

export type SearchBunDocsResult = BunDocsSearchResult | SearchBunDocsFailure;

export async function searchBunDocs(input: unknown, dependencies: SearchBunDocsDependencies): Promise<SearchBunDocsResult> {
  const parsed = searchBunDocsInputSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      error: createInvalidInputError(parsed.error)
    };
  }

  return dependencies.adapter.search({
    query: parsed.data.query,
    ...(parsed.data.topic === undefined ? {} : { topic: parsed.data.topic as BunDocsTopic })
  });
}
