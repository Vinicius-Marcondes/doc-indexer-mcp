import { createStructuredError, type StructuredError } from "../../shared/errors";
import type { BunDocsIngestionPipeline, IngestionResult } from "../ingestion/ingestion-pipeline";
import type { DocsSourceRegistry } from "../sources/registry";
import type {
  CreateRefreshJobInput,
  RefreshJobReason,
  RefreshJobType
} from "../storage/docs-storage";
import type { RefreshJobQueue, RefreshQueueStore, RefreshQueueStoredJob } from "./refresh-queue";

export type DocsRefreshExecutionResult =
  | {
      readonly ok: true;
    }
  | {
      readonly ok: false;
      readonly error: StructuredError;
    };

export interface RefreshWorkerJob extends RefreshQueueStoredJob {
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly finishedAt?: string | null;
  readonly attemptCount?: number;
}

export interface DocsRefreshWorkerStore extends RefreshQueueStore {
  readonly claimRunnableRefreshJobs: (input: {
    readonly limit: number;
    readonly now: string;
  }) => Promise<readonly RefreshWorkerJob[]>;
  readonly updateRefreshJobStatus: (input: {
    readonly id: number;
    readonly status: "queued" | "running" | "succeeded" | "failed";
    readonly lastError?: string;
    readonly now?: string;
  }) => Promise<RefreshWorkerJob>;
  readonly getLatestRefreshJob: (input: {
    readonly sourceId: string;
    readonly jobType: RefreshJobType;
    readonly reason?: RefreshJobReason;
  }) => Promise<RefreshWorkerJob | null>;
}

export interface DocsRefreshJobExecutor {
  readonly refreshSourceIndex: (input: {
    readonly sourceId: string;
    readonly maxPagesPerRun: number;
  }) => Promise<DocsRefreshExecutionResult>;
  readonly refreshPage: (input: {
    readonly sourceId: string;
    readonly url: string;
  }) => Promise<DocsRefreshExecutionResult>;
  readonly refreshEmbeddings: (input: {
    readonly sourceId: string;
    readonly url?: string;
    readonly maxEmbeddingsPerRun: number;
  }) => Promise<DocsRefreshExecutionResult>;
  readonly checkTombstones: (input: {
    readonly sourceId: string;
    readonly url?: string;
  }) => Promise<DocsRefreshExecutionResult>;
}

export interface DocsRefreshWorkerOptions {
  readonly store: DocsRefreshWorkerStore;
  readonly queue: RefreshJobQueue;
  readonly executor: DocsRefreshJobExecutor;
  readonly sourceRegistry: DocsSourceRegistry;
  readonly now: () => string;
  readonly refreshIntervalSeconds: number;
  readonly maxJobsPerRun: number;
  readonly maxPagesPerRun: number;
  readonly maxEmbeddingsPerRun: number;
  readonly maxConcurrency: number;
}

export interface ScheduledRefreshResult {
  readonly checked: number;
  readonly enqueued: number;
  readonly deduplicated: number;
  readonly skipped: number;
}

export interface DocsRefreshWorkerRunResult {
  readonly processed: number;
  readonly succeeded: number;
  readonly failed: number;
}

export interface DocsRefreshWorkerCycleResult extends DocsRefreshWorkerRunResult {
  readonly scheduled: ScheduledRefreshResult;
}

export function shouldEnqueueScheduledRefresh(input: {
  readonly latestJob: {
    readonly createdAt?: string;
    readonly finishedAt?: string | null;
    readonly runAfter?: string;
    readonly status?: string;
  } | null;
  readonly now: string;
  readonly refreshIntervalSeconds: number;
}): boolean {
  if (input.latestJob === null) {
    return true;
  }

  if (input.latestJob.status === "queued" || input.latestJob.status === "running") {
    return false;
  }

  const latestTimestamp = input.latestJob.finishedAt ?? input.latestJob.createdAt ?? input.latestJob.runAfter;

  if (latestTimestamp === undefined) {
    return true;
  }
  const latestMs = Date.parse(latestTimestamp);
  const nowMs = Date.parse(input.now);

  if (Number.isNaN(latestMs) || Number.isNaN(nowMs)) {
    return true;
  }

  return nowMs - latestMs >= input.refreshIntervalSeconds * 1000;
}

function structuredErrorText(error: StructuredError): string {
  return JSON.stringify({
    code: error.code,
    message: error.message,
    details: error.details
  });
}

async function runWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const item = items[nextIndex];
        nextIndex += 1;

        if (item !== undefined) {
          await worker(item);
        }
      }
    })
  );
}

function missingUrlError(job: RefreshWorkerJob): StructuredError {
  return createStructuredError("invalid_input", "Refresh job requires a page URL.", {
    jobId: job.id,
    jobType: job.jobType
  });
}

function normalizeLimit(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }

  return Math.max(1, Math.floor(value));
}

export class DocsRefreshWorker {
  private readonly store: DocsRefreshWorkerStore;
  private readonly queue: RefreshJobQueue;
  private readonly executor: DocsRefreshJobExecutor;
  private readonly sourceRegistry: DocsSourceRegistry;
  private readonly now: () => string;
  private readonly refreshIntervalSeconds: number;
  private readonly maxJobsPerRun: number;
  private readonly maxPagesPerRun: number;
  private readonly maxEmbeddingsPerRun: number;
  private readonly maxConcurrency: number;

  constructor(options: DocsRefreshWorkerOptions) {
    this.store = options.store;
    this.queue = options.queue;
    this.executor = options.executor;
    this.sourceRegistry = options.sourceRegistry;
    this.now = options.now;
    this.refreshIntervalSeconds = normalizeLimit(options.refreshIntervalSeconds);
    this.maxJobsPerRun = normalizeLimit(options.maxJobsPerRun);
    this.maxPagesPerRun = normalizeLimit(options.maxPagesPerRun);
    this.maxEmbeddingsPerRun = normalizeLimit(options.maxEmbeddingsPerRun);
    this.maxConcurrency = normalizeLimit(options.maxConcurrency);
  }

  async enqueueScheduledRefresh(): Promise<ScheduledRefreshResult> {
    let checked = 0;
    let enqueued = 0;
    let deduplicated = 0;
    let skipped = 0;
    const generatedAt = this.now();

    for (const source of this.sourceRegistry.list()) {
      if (!source.enabled) {
        continue;
      }

      checked += 1;
      const latestJob = await this.store.getLatestRefreshJob({
        sourceId: source.sourceId,
        jobType: "source_index",
        reason: "scheduled"
      });

      if (
        !shouldEnqueueScheduledRefresh({
          latestJob,
          now: generatedAt,
          refreshIntervalSeconds: this.refreshIntervalSeconds
        })
      ) {
        skipped += 1;
        continue;
      }

      const result = await this.queue.enqueue({
        sourceId: source.sourceId,
        jobType: "source_index",
        reason: "scheduled",
        prioritySignals: {
          contentAgeHours: this.refreshIntervalSeconds / 3600
        }
      });

      if (result.status === "queued") {
        enqueued += 1;
      } else if (result.status === "deduplicated") {
        deduplicated += 1;
      } else {
        skipped += 1;
      }
    }

    return { checked, enqueued, deduplicated, skipped };
  }

  async runOnce(): Promise<DocsRefreshWorkerRunResult> {
    const jobs = await this.store.claimRunnableRefreshJobs({
      limit: this.maxJobsPerRun,
      now: this.now()
    });
    let succeeded = 0;
    let failed = 0;

    await runWithConcurrency(jobs, this.maxConcurrency, async (job) => {
      const result = await this.executeJob(job);
      const finishedAt = this.now();

      if (result.ok) {
        await this.store.updateRefreshJobStatus({
          id: job.id,
          status: "succeeded",
          now: finishedAt
        });
        succeeded += 1;
        return;
      }

      await this.store.updateRefreshJobStatus({
        id: job.id,
        status: "failed",
        lastError: structuredErrorText(result.error),
        now: finishedAt
      });
      failed += 1;
    });

    return {
      processed: jobs.length,
      succeeded,
      failed
    };
  }

  async runCycle(): Promise<DocsRefreshWorkerCycleResult> {
    const scheduled = await this.enqueueScheduledRefresh();
    const run = await this.runOnce();

    return {
      ...run,
      scheduled
    };
  }

  private async executeJob(job: RefreshWorkerJob): Promise<DocsRefreshExecutionResult> {
    switch (job.jobType) {
      case "source_index":
        return this.executor.refreshSourceIndex({
          sourceId: job.sourceId,
          maxPagesPerRun: this.maxPagesPerRun
        });
      case "page":
        if (job.url === null) {
          return { ok: false, error: missingUrlError(job) };
        }
        return this.executor.refreshPage({ sourceId: job.sourceId, url: job.url });
      case "embedding":
        return this.executor.refreshEmbeddings({
          sourceId: job.sourceId,
          ...(job.url === null ? {} : { url: job.url }),
          maxEmbeddingsPerRun: this.maxEmbeddingsPerRun
        });
      case "tombstone_check":
        return this.executor.checkTombstones({
          sourceId: job.sourceId,
          ...(job.url === null ? {} : { url: job.url })
        });
    }
  }
}

function executionResultFromIngestion(result: IngestionResult): DocsRefreshExecutionResult {
  if (result.ok) {
    return { ok: true };
  }

  return {
    ok: false,
    error: result.error
  };
}

export class BunDocsRefreshJobExecutor implements DocsRefreshJobExecutor {
  private readonly pipeline: BunDocsIngestionPipeline;

  constructor(input: { readonly pipeline: BunDocsIngestionPipeline }) {
    this.pipeline = input.pipeline;
  }

  async refreshSourceIndex(input: { readonly sourceId: string; readonly maxPagesPerRun: number }): Promise<DocsRefreshExecutionResult> {
    if (input.sourceId !== "bun") {
      return {
        ok: false,
        error: createStructuredError("disallowed_source", "Unsupported docs source for this worker.", {
          sourceId: input.sourceId
        })
      };
    }

    return executionResultFromIngestion(await this.pipeline.ingestFromIndex({ limit: input.maxPagesPerRun }));
  }

  async refreshPage(input: { readonly sourceId: string; readonly url: string }): Promise<DocsRefreshExecutionResult> {
    if (input.sourceId !== "bun") {
      return {
        ok: false,
        error: createStructuredError("disallowed_source", "Unsupported docs source for this worker.", {
          sourceId: input.sourceId
        })
      };
    }

    return executionResultFromIngestion(await this.pipeline.ingestPage(input.url));
  }

  async refreshEmbeddings(input: {
    readonly sourceId: string;
    readonly url?: string;
    readonly maxEmbeddingsPerRun: number;
  }): Promise<DocsRefreshExecutionResult> {
    if (input.url !== undefined) {
      return this.refreshPage({ sourceId: input.sourceId, url: input.url });
    }

    return this.refreshSourceIndex({
      sourceId: input.sourceId,
      maxPagesPerRun: input.maxEmbeddingsPerRun
    });
  }

  async checkTombstones(_input: { readonly sourceId: string; readonly url?: string }): Promise<DocsRefreshExecutionResult> {
    return { ok: true };
  }
}

export type { CreateRefreshJobInput };
