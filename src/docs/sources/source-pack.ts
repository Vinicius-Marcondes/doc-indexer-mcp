import { createDisallowedSourceError, type StructuredError } from "../../shared/errors";

export type DocsSourceUrlKind = "index" | "page";

export interface DocsChunkingDefaults {
  readonly targetTokens: number;
  readonly overlapTokens: number;
}

export interface DocsRefreshPolicy {
  readonly defaultTtlSeconds: number;
}

export interface DocsSourceUrlAllowed {
  readonly allowed: true;
  readonly sourceId: string;
  readonly url: URL;
  readonly urlKind: DocsSourceUrlKind;
}

export interface DocsSourceUrlDisallowed {
  readonly allowed: false;
  readonly error: StructuredError;
}

export type DocsSourceUrlCheckResult = DocsSourceUrlAllowed | DocsSourceUrlDisallowed;

export interface DocsSourcePack {
  readonly sourceId: string;
  readonly displayName: string;
  readonly enabled: boolean;
  readonly allowedHosts: readonly string[];
  readonly indexUrls: readonly string[];
  readonly allowedUrlPatterns: readonly string[];
  readonly chunking: DocsChunkingDefaults;
  readonly refreshPolicy: DocsRefreshPolicy;
  readonly checkUrl: (input: string | URL) => DocsSourceUrlCheckResult;
}

export function disallowedDocsSourceUrl(input: string | URL): DocsSourceUrlDisallowed {
  return {
    allowed: false,
    error: createDisallowedSourceError(String(input))
  };
}

export function parseDocsSourceUrl(input: string | URL): URL | null {
  try {
    return input instanceof URL ? new URL(input.href) : new URL(input);
  } catch {
    return null;
  }
}
