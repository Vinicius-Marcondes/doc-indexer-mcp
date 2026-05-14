export type DocsFreshnessState = "fresh" | "stale" | "missing" | "refreshing";

export interface FreshnessPolicyPage {
  readonly expiresAt: string | null;
  readonly tombstonedAt?: string | null;
}

export interface DocsFreshnessPolicyInput {
  readonly page: FreshnessPolicyPage | null;
  readonly now: string;
  readonly refreshPending?: boolean;
  readonly maxStaleAgeMs?: number;
}

export interface DocsFreshnessPolicyResult {
  readonly freshness: DocsFreshnessState;
  readonly staleAgeMs: number | null;
  readonly beyondMaxStaleAge: boolean;
}

export function computeDocsFreshness(input: DocsFreshnessPolicyInput): DocsFreshnessPolicyResult {
  if (input.page === null || input.page.tombstonedAt !== null && input.page.tombstonedAt !== undefined) {
    return {
      freshness: "missing",
      staleAgeMs: null,
      beyondMaxStaleAge: false
    };
  }

  if (input.refreshPending === true) {
    return {
      freshness: "refreshing",
      staleAgeMs: null,
      beyondMaxStaleAge: false
    };
  }

  if (input.page.expiresAt === null) {
    return {
      freshness: "fresh",
      staleAgeMs: null,
      beyondMaxStaleAge: false
    };
  }

  const expiresAtMs = Date.parse(input.page.expiresAt);
  const nowMs = Date.parse(input.now);

  if (Number.isNaN(expiresAtMs) || Number.isNaN(nowMs)) {
    return {
      freshness: "stale",
      staleAgeMs: null,
      beyondMaxStaleAge: false
    };
  }

  if (expiresAtMs > nowMs) {
    return {
      freshness: "fresh",
      staleAgeMs: null,
      beyondMaxStaleAge: false
    };
  }

  const staleAgeMs = nowMs - expiresAtMs;

  return {
    freshness: "stale",
    staleAgeMs,
    beyondMaxStaleAge: input.maxStaleAgeMs === undefined ? false : staleAgeMs > input.maxStaleAgeMs
  };
}
