import { createStructuredError, type StructuredError } from "../../shared/errors";
import type {
  CreateRefreshJobInput,
  RefreshJobReason,
  RefreshJobType
} from "../storage/docs-storage";
import type { DocsSourceRegistry } from "../sources/registry";

export interface RefreshPrioritySignals {
  readonly contentAgeHours?: number;
  readonly recentRequestCount?: number;
  readonly staleHitCount?: number;
  readonly lowConfidenceSearchCount?: number;
  readonly recentFailureCount?: number;
}

export interface RefreshQueueStoredJob {
  readonly id: number;
  readonly sourceId: string;
  readonly url: string | null;
  readonly jobType: RefreshJobType;
  readonly reason: RefreshJobReason;
  status: "queued" | "running" | "succeeded" | "failed" | "deduplicated";
  readonly priority: number;
  readonly runAfter: string;
  lastError?: string;
}

export interface RefreshQueueStore {
  readonly findPendingRefreshJob: (input: {
    readonly sourceId: string;
    readonly url?: string;
    readonly jobType: RefreshJobType;
  }) => Promise<RefreshQueueStoredJob | null>;
  readonly countPendingRefreshJobs: (input?: { readonly sourceId?: string }) => Promise<number>;
  readonly createRefreshJob: (input: CreateRefreshJobInput) => Promise<RefreshQueueStoredJob>;
}

export interface RefreshJobQueueOptions {
  readonly store: RefreshQueueStore;
  readonly sourceRegistry: DocsSourceRegistry;
  readonly now: () => string;
  readonly maxPendingJobs: number;
  readonly maxPendingJobsPerSource: number;
}

export interface EnqueueRefreshJobInput {
  readonly sourceId: string;
  readonly url?: string;
  readonly jobType: RefreshJobType;
  readonly reason: RefreshJobReason;
  readonly prioritySignals?: RefreshPrioritySignals;
}

export type EnqueueRefreshJobResult =
  | {
      readonly status: "queued";
      readonly job: RefreshQueueStoredJob;
      readonly priority: number;
      readonly runAfter: string;
    }
  | {
      readonly status: "deduplicated";
      readonly job: RefreshQueueStoredJob;
      readonly priority: number;
      readonly runAfter: string;
    }
  | {
      readonly status: "skipped_bounds";
      readonly reason: "global_limit" | "per_source_limit";
    }
  | {
      readonly status: "rejected_policy";
      readonly error: StructuredError;
    };

function positive(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, value);
}

export function computeRefreshPriority(signals: RefreshPrioritySignals): number {
  const agePressure = Math.min(200, positive(signals.contentAgeHours) / 6);
  const requestBoost = Math.min(120, positive(signals.recentRequestCount) * 6);
  const staleBoost = Math.min(180, positive(signals.staleHitCount) * 20);
  const lowConfidenceBoost = Math.min(160, positive(signals.lowConfidenceSearchCount) * 12);
  const failurePenalty = Math.min(160, positive(signals.recentFailureCount) * 25);
  const priority = 50 + agePressure + requestBoost + staleBoost + lowConfidenceBoost - failurePenalty;

  return Math.max(0, Math.round(priority));
}

function delayedRunAfter(now: string, recentFailureCount: number): string {
  const nowMs = Date.parse(now);
  const base = Number.isNaN(nowMs) ? Date.now() : nowMs;
  const delayMs = positive(recentFailureCount) * 15 * 60 * 1000;

  return new Date(base + delayMs).toISOString();
}

export class RefreshJobQueue {
  private readonly store: RefreshQueueStore;
  private readonly sourceRegistry: DocsSourceRegistry;
  private readonly now: () => string;
  private readonly maxPendingJobs: number;
  private readonly maxPendingJobsPerSource: number;

  constructor(options: RefreshJobQueueOptions) {
    this.store = options.store;
    this.sourceRegistry = options.sourceRegistry;
    this.now = options.now;
    this.maxPendingJobs = options.maxPendingJobs;
    this.maxPendingJobsPerSource = options.maxPendingJobsPerSource;
  }

  async enqueue(input: EnqueueRefreshJobInput): Promise<EnqueueRefreshJobResult> {
    const sourcePack = this.sourceRegistry.get(input.sourceId);

    if (sourcePack === undefined || !sourcePack.enabled) {
      return {
        status: "rejected_policy",
        error: createStructuredError("disallowed_source", "Docs source is not enabled for this MCP server.", {
          sourceId: input.sourceId,
          allowedSourceIds: this.sourceRegistry.list().map((source) => source.sourceId)
        })
      };
    }

    if (input.url !== undefined) {
      const checkedUrl = sourcePack.checkUrl(input.url);

      if (!checkedUrl.allowed || checkedUrl.sourceId !== input.sourceId || checkedUrl.urlKind !== "page") {
        return {
          status: "rejected_policy",
          error: checkedUrl.allowed
            ? createStructuredError("disallowed_source", "URL is not allowed for the requested docs source.", {
                sourceId: input.sourceId,
                url: input.url
              })
            : checkedUrl.error
        };
      }
    }

    const pending = await this.store.findPendingRefreshJob({
      sourceId: input.sourceId,
      ...(input.url === undefined ? {} : { url: input.url }),
      jobType: input.jobType
    });

    if (pending !== null) {
      return {
        status: "deduplicated",
        job: pending,
        priority: pending.priority,
        runAfter: pending.runAfter
      };
    }

    const perSourcePending = await this.store.countPendingRefreshJobs({ sourceId: input.sourceId });

    if (perSourcePending >= this.maxPendingJobsPerSource) {
      return {
        status: "skipped_bounds",
        reason: "per_source_limit"
      };
    }

    const globalPending = await this.store.countPendingRefreshJobs();

    if (globalPending >= this.maxPendingJobs) {
      return {
        status: "skipped_bounds",
        reason: "global_limit"
      };
    }

    const priority = computeRefreshPriority(input.prioritySignals ?? {});
    const runAfter = delayedRunAfter(this.now(), input.prioritySignals?.recentFailureCount ?? 0);
    const job = await this.store.createRefreshJob({
      sourceId: input.sourceId,
      ...(input.url === undefined ? {} : { url: input.url }),
      jobType: input.jobType,
      reason: input.reason,
      priority,
      runAfter
    });

    return {
      status: "queued",
      job,
      priority,
      runAfter
    };
  }
}
