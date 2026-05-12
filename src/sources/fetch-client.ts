import { computeContentHash } from "../cache/sqlite-cache";
import { createStructuredError, type StructuredError } from "../shared/errors";
import { checkSourceUrl, type AllowedSourceKind } from "./allowlist";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface SourceFetchClientOptions {
  readonly fetchImpl?: FetchLike;
  readonly timeoutMs?: number;
  readonly now?: () => string;
  readonly allowLocalTestUrls?: boolean;
}

export interface FetchTextSuccess {
  readonly ok: true;
  readonly body: string;
  readonly finalUrl: string;
  readonly status: number;
  readonly fetchedAt: string;
  readonly contentHash: string;
  readonly sourceType: AllowedSourceKind;
}

export interface FetchTextFailure {
  readonly ok: false;
  readonly error: StructuredError;
}

export type FetchTextResult = FetchTextSuccess | FetchTextFailure;

export class SourceFetchClient {
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly now: () => string;
  private readonly allowLocalTestUrls: boolean;

  constructor(options: SourceFetchClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.now = options.now ?? (() => new Date().toISOString());
    this.allowLocalTestUrls = options.allowLocalTestUrls ?? false;
  }

  async fetchText(inputUrl: string): Promise<FetchTextResult> {
    const allowed = checkSourceUrl(inputUrl, { allowLocalTestUrls: this.allowLocalTestUrls });

    if (!allowed.allowed) {
      return {
        ok: false,
        error: allowed.error
      };
    }

    const controller = new AbortController();
    const href = allowed.url.href;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error(`Fetch timed out after ${this.timeoutMs}ms.`));
        }, this.timeoutMs);
      });

      const response = await Promise.race([
        this.fetchImpl(href, { signal: controller.signal }),
        timeoutPromise
      ]);

      if (!response.ok) {
        return {
          ok: false,
          error: createStructuredError("fetch_failed", "Source fetch failed with a non-success HTTP status.", {
            sourceUrl: href,
            status: response.status,
            statusText: response.statusText
          })
        };
      }

      const body = await response.text();

      return {
        ok: true,
        body,
        finalUrl: response.url.length > 0 ? response.url : href,
        status: response.status,
        fetchedAt: this.now(),
        contentHash: computeContentHash(body),
        sourceType: allowed.sourceType
      };
    } catch (error) {
      const reason = error instanceof Error && error.message.length > 0 ? error.message : "unknown fetch failure";

      return {
        ok: false,
        error: createStructuredError("fetch_failed", reason.includes("timed out") ? reason : "Source fetch failed.", {
          sourceUrl: href,
          reason
        })
      };
    } finally {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
    }
  }
}
