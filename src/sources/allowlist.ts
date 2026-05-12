import type { SourceType } from "../shared/contracts";
import { createDisallowedSourceError, type StructuredError } from "../shared/errors";

export type AllowedSourceKind = SourceType | "local-test";

export interface AllowLocalTestUrlsOptions {
  readonly allowLocalTestUrls?: boolean;
}

export interface AllowedSourceUrl {
  readonly allowed: true;
  readonly url: URL;
  readonly sourceType: AllowedSourceKind;
}

export interface DisallowedSourceUrl {
  readonly allowed: false;
  readonly error: StructuredError;
}

export type SourceUrlCheckResult = AllowedSourceUrl | DisallowedSourceUrl;

const localTestHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

function disallowed(input: string | URL): DisallowedSourceUrl {
  return {
    allowed: false,
    error: createDisallowedSourceError(String(input))
  };
}

function parseUrl(input: string | URL): URL | null {
  try {
    return input instanceof URL ? input : new URL(input);
  } catch {
    return null;
  }
}

function hasEncodedPathTrick(url: URL): boolean {
  return /%(2e|2f|5c)/iu.test(url.pathname);
}

function isAllowedRegistryPath(url: URL): boolean {
  const path = url.pathname.slice(1);

  if (path.length === 0 || /%(2e|5c)/iu.test(path)) {
    return false;
  }

  const decoded = decodeURIComponent(path);

  if (decoded.startsWith("@")) {
    return /^@[^/]+\/[^/]+$/u.test(decoded);
  }

  return !decoded.includes("/");
}

function allowedOfficialSource(url: URL): AllowedSourceKind | null {
  if (url.hostname === "bun.com" && url.pathname.startsWith("/docs") && !hasEncodedPathTrick(url)) {
    return "bun-docs";
  }

  if (url.hostname === "registry.npmjs.org" && isAllowedRegistryPath(url)) {
    return "npm-registry";
  }

  if (url.hostname === "modelcontextprotocol.io" && !hasEncodedPathTrick(url)) {
    return "mcp-docs";
  }

  if (
    url.hostname === "github.com" &&
    url.pathname.startsWith("/modelcontextprotocol/typescript-sdk") &&
    !hasEncodedPathTrick(url)
  ) {
    return "mcp-docs";
  }

  if (
    url.hostname === "www.typescriptlang.org" &&
    (url.pathname.startsWith("/docs") || url.pathname.startsWith("/tsconfig")) &&
    !hasEncodedPathTrick(url)
  ) {
    return "typescript-docs";
  }

  return null;
}

export function checkSourceUrl(input: string | URL, options: AllowLocalTestUrlsOptions = {}): SourceUrlCheckResult {
  const url = parseUrl(input);

  if (url === null) {
    return disallowed(input);
  }

  if (options.allowLocalTestUrls === true && url.protocol === "http:" && localTestHosts.has(url.hostname)) {
    return {
      allowed: true,
      url,
      sourceType: "local-test"
    };
  }

  if (url.protocol !== "https:") {
    return disallowed(input);
  }

  const sourceType = allowedOfficialSource(url);

  if (sourceType === null) {
    return disallowed(input);
  }

  return {
    allowed: true,
    url,
    sourceType
  };
}
