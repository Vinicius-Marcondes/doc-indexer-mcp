import type { StoredDocsPage } from "../../resources/docs-resources";
import type { StructuredError } from "../../shared/errors";

export type ConfirmedRemovalStatus = 404 | 410;

export interface DocsTombstonePolicyStore {
  readonly recordConfirmedRemovalFailure: (input: {
    readonly sourceId: string;
    readonly url: string;
    readonly status: ConfirmedRemovalStatus;
    readonly error: StructuredError;
    readonly now: string;
  }) => Promise<number>;
  readonly markPageTombstoned: (input: {
    readonly sourceId: string;
    readonly url: string;
    readonly reason: string;
    readonly now: string;
  }) => Promise<StoredDocsPage | null>;
}

export type TombstonePolicyResult =
  | {
      readonly status: "ignored";
      readonly tombstoned: false;
      readonly confirmedFailures: 0;
    }
  | {
      readonly status: "recorded";
      readonly tombstoned: false;
      readonly confirmedFailures: number;
    }
  | {
      readonly status: "tombstoned";
      readonly tombstoned: true;
      readonly confirmedFailures: number;
      readonly page: StoredDocsPage | null;
    };

export interface TombstonePolicyInput {
  readonly sourceId: string;
  readonly url: string;
  readonly error: StructuredError;
  readonly store: DocsTombstonePolicyStore;
  readonly now: string;
  readonly confirmationThreshold?: number;
}

const DEFAULT_CONFIRMATION_THRESHOLD = 2;

function confirmedRemovalStatus(error: StructuredError): ConfirmedRemovalStatus | null {
  const status = error.details?.status;

  if (status === 404 || status === 410) {
    return status;
  }

  return null;
}

export function isConfirmedRemovalError(error: StructuredError): boolean {
  return confirmedRemovalStatus(error) !== null;
}

export async function recordTombstoneRefreshFailure(input: TombstonePolicyInput): Promise<TombstonePolicyResult> {
  const status = confirmedRemovalStatus(input.error);

  if (status === null) {
    return {
      status: "ignored",
      tombstoned: false,
      confirmedFailures: 0
    };
  }

  const confirmedFailures = await input.store.recordConfirmedRemovalFailure({
    sourceId: input.sourceId,
    url: input.url,
    status,
    error: input.error,
    now: input.now
  });
  const threshold = input.confirmationThreshold ?? DEFAULT_CONFIRMATION_THRESHOLD;

  if (confirmedFailures < threshold) {
    return {
      status: "recorded",
      tombstoned: false,
      confirmedFailures
    };
  }

  const page = await input.store.markPageTombstoned({
    sourceId: input.sourceId,
    url: input.url,
    reason: `confirmed source removal after ${confirmedFailures} failed fetches`,
    now: input.now
  });

  return {
    status: "tombstoned",
    tombstoned: true,
    confirmedFailures,
    page
  };
}
