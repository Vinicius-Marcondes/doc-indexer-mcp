import { createDocsSourceRegistry } from "./registry";
import {
  disallowedDocsSourceUrl,
  parseDocsSourceUrl,
  type DocsSourcePack,
  type DocsSourceUrlCheckResult
} from "./source-pack";

const bunIndexUrls = ["https://bun.com/docs/llms.txt", "https://bun.com/docs/llms-full.txt"] as const;
const bunDocsHost = "bun.com";

function hasEncodedPathTrick(url: URL): boolean {
  return /%(2e|2f|5c)/iu.test(url.pathname);
}

function isBunDocsPage(url: URL): boolean {
  return url.pathname.startsWith("/docs/") && !url.pathname.endsWith("/llms.txt") && !url.pathname.endsWith("/llms-full.txt");
}

function isBunDocsIndex(url: URL): boolean {
  return bunIndexUrls.includes(url.href as (typeof bunIndexUrls)[number]);
}

function checkBunDocsUrl(input: string | URL): DocsSourceUrlCheckResult {
  const url = parseDocsSourceUrl(input);

  if (url === null || url.protocol !== "https:" || url.hostname !== bunDocsHost || hasEncodedPathTrick(url)) {
    return disallowedDocsSourceUrl(input);
  }

  if (isBunDocsIndex(url)) {
    return {
      allowed: true,
      sourceId: "bun",
      url,
      urlKind: "index"
    };
  }

  if (isBunDocsPage(url)) {
    return {
      allowed: true,
      sourceId: "bun",
      url,
      urlKind: "page"
    };
  }

  return disallowedDocsSourceUrl(input);
}

export const bunDocsSourcePack: DocsSourcePack = {
  sourceId: "bun",
  displayName: "Bun Documentation",
  enabled: true,
  allowedHosts: [bunDocsHost],
  indexUrls: bunIndexUrls,
  allowedUrlPatterns: ["https://bun.com/docs/llms.txt", "https://bun.com/docs/llms-full.txt", "https://bun.com/docs/*"],
  chunking: {
    targetTokens: 900,
    overlapTokens: 120
  },
  refreshPolicy: {
    defaultTtlSeconds: 7 * 24 * 60 * 60
  },
  checkUrl: checkBunDocsUrl
};

export function revalidateSourceRedirect(
  sourcePack: DocsSourcePack,
  originalUrl: string | URL,
  redirectLocation: string
): DocsSourceUrlCheckResult {
  const original = parseDocsSourceUrl(originalUrl);

  if (original === null) {
    return disallowedDocsSourceUrl(originalUrl);
  }

  try {
    return sourcePack.checkUrl(new URL(redirectLocation, original));
  } catch {
    return disallowedDocsSourceUrl(redirectLocation);
  }
}

export const defaultDocsSourceRegistry = createDocsSourceRegistry([bunDocsSourcePack]);
export { createDocsSourceRegistry };
export type { DocsSourcePack, DocsSourceUrlCheckResult } from "./source-pack";
