import { describe, expect, test } from "bun:test";
import { createStructuredError } from "../../../../src/shared/errors";
import { RefreshJobQueue, type RefreshQueueStoredJob } from "../../../../src/docs/refresh/refresh-queue";
import {
  DocsRefreshWorker,
  shouldEnqueueScheduledRefresh,
  type DocsRefreshJobExecutor,
  type DocsRefreshWorkerStore
} from "../../../../src/docs/refresh/docs-worker";
import type {
  CreateRefreshJobInput,
  RefreshJobReason,
  RefreshJobType
} from "../../../../src/docs/storage/docs-storage";
import { defaultDocsSourceRegistry } from "../../../../src/docs/sources/bun-source-pack";

const now = "2026-05-14T12:00:00.000Z";
const pageUrl = "https://bun.com/docs/runtime/http-server";

type MutableWorkerJob = RefreshQueueStoredJob & {
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  attemptCount: number;
};

class InMemoryWorkerStore implements DocsRefreshWorkerStore {
  readonly jobs: MutableWorkerJob[] = [];
  nextId = 1;

  seed(
    input: Partial<CreateRefreshJobInput> & {
      status?: MutableWorkerJob["status"];
      createdAt?: string;
      startedAt?: string | null;
      attemptCount?: number;
    } = {}
  ) {
    const timestamp = input.createdAt ?? now;
    const job: MutableWorkerJob = {
      id: this.nextId,
      sourceId: input.sourceId ?? "bun",
      url: input.url ?? null,
      jobType: input.jobType ?? "page",
      reason: input.reason ?? "missing_content",
      status: input.status ?? "queued",
      priority: input.priority ?? 50,
      runAfter: input.runAfter ?? now,
      createdAt: timestamp,
      updatedAt: timestamp,
      startedAt: input.startedAt ?? (input.status === "running" ? timestamp : null),
      finishedAt: input.status === "succeeded" || input.status === "failed" ? timestamp : null,
      attemptCount: input.attemptCount ?? 0
    };
    this.nextId += 1;
    this.jobs.push(job);
    return job;
  }

  async findPendingRefreshJob(input: {
    sourceId: string;
    url?: string;
    jobType: RefreshJobType;
  }): Promise<RefreshQueueStoredJob | null> {
    return (
      this.jobs.find(
        (job) =>
          job.sourceId === input.sourceId &&
          job.url === (input.url ?? null) &&
          job.jobType === input.jobType &&
          (job.status === "queued" || job.status === "running")
      ) ?? null
    );
  }

  async countPendingRefreshJobs(input: { sourceId?: string } = {}): Promise<number> {
    return this.jobs.filter(
      (job) =>
        (input.sourceId === undefined || job.sourceId === input.sourceId) &&
        (job.status === "queued" || job.status === "running")
    ).length;
  }

  async createRefreshJob(input: CreateRefreshJobInput): Promise<RefreshQueueStoredJob> {
    return this.seed(input);
  }

  async claimRunnableRefreshJobs(input: { limit: number; now: string }): Promise<MutableWorkerJob[]> {
    const nowMs = Date.parse(input.now);
    const runnable = this.jobs
      .filter((job) => job.status === "queued" && Date.parse(job.runAfter) <= nowMs)
      .sort((left, right) => right.priority - left.priority || left.id - right.id)
      .slice(0, input.limit);

    for (const job of runnable) {
      job.status = "running";
      job.attemptCount += 1;
      job.startedAt = input.now;
      job.updatedAt = input.now;
    }

    return runnable;
  }

  async updateRefreshJobStatus(input: {
    id: number;
    status: "queued" | "running" | "succeeded" | "failed";
    lastError?: string;
    now?: string;
  }): Promise<MutableWorkerJob> {
    const job = this.jobs.find((item) => item.id === input.id);
    if (job === undefined) {
      throw new Error(`Missing job ${input.id}.`);
    }

    job.status = input.status;
    job.lastError = input.lastError;
    job.updatedAt = input.now ?? now;
    if (input.status === "running") {
      job.startedAt = input.now ?? now;
    }
    if (input.status === "succeeded" || input.status === "failed") {
      job.finishedAt = input.now ?? now;
    }
    return job;
  }

  async recoverStaleRunningRefreshJobs(input: {
    now: string;
    staleBefore: string;
    limit: number;
    timeoutSeconds: number;
  }): Promise<MutableWorkerJob[]> {
    const staleBeforeMs = Date.parse(input.staleBefore);
    const nowMs = Date.parse(input.now);
    const stale = this.jobs
      .filter((job) => {
        const startedAt = job.startedAt ?? job.updatedAt;
        return job.status === "running" && Date.parse(startedAt) <= staleBeforeMs;
      })
      .sort((left, right) => Date.parse(left.startedAt ?? left.updatedAt) - Date.parse(right.startedAt ?? right.updatedAt) || left.id - right.id)
      .slice(0, input.limit);

    for (const job of stale) {
      const startedAt = job.startedAt ?? job.updatedAt;
      const startedMs = Date.parse(startedAt);
      job.status = "failed";
      job.updatedAt = input.now;
      job.finishedAt = input.now;
      job.lastError = JSON.stringify({
        code: "internal_error",
        message: "Docs refresh job exceeded running timeout.",
        details: {
          jobId: job.id,
          sourceId: job.sourceId,
          jobType: job.jobType,
          attemptCount: job.attemptCount,
          startedAt,
          timeoutSeconds: input.timeoutSeconds,
          ageSeconds: Math.max(0, Math.floor((nowMs - startedMs) / 1000))
        }
      });
    }

    return stale;
  }

  async getLatestRefreshJob(input: {
    sourceId: string;
    jobType: RefreshJobType;
    reason?: RefreshJobReason;
  }): Promise<MutableWorkerJob | null> {
    return (
      this.jobs
        .filter(
          (job) =>
            job.sourceId === input.sourceId &&
            job.jobType === input.jobType &&
            (input.reason === undefined || job.reason === input.reason)
        )
        .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0] ?? null
    );
  }
}

class FakeExecutor implements DocsRefreshJobExecutor {
  readonly sourceIndexCalls: string[] = [];
  readonly pageCalls: string[] = [];
  readonly embeddingCalls: string[] = [];
  readonly tombstoneCalls: string[] = [];
  maxActive = 0;
  private active = 0;

  constructor(
    private readonly failJobTypes = new Set<RefreshJobType>(),
    private readonly throwJobTypes = new Set<RefreshJobType>()
  ) {}

  private async run(jobType: RefreshJobType): Promise<{ ok: true } | { ok: false; error: ReturnType<typeof createStructuredError> }> {
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    this.active -= 1;

    if (this.throwJobTypes.has(jobType)) {
      throw new Error(`Unexpected refresh failure with Authorization: Bearer secret-token and full page content for ${jobType}.`);
    }

    if (this.failJobTypes.has(jobType)) {
      return {
        ok: false,
        error: createStructuredError("fetch_failed", "Refresh failed in fake executor.", { jobType })
      };
    }

    return { ok: true };
  }

  async refreshSourceIndex(input: { sourceId: string }) {
    this.sourceIndexCalls.push(input.sourceId);
    return this.run("source_index");
  }

  async refreshPage(input: { sourceId: string; url: string }) {
    this.pageCalls.push(`${input.sourceId}:${input.url}`);
    return this.run("page");
  }

  async refreshEmbeddings(input: { sourceId: string; url?: string }) {
    this.embeddingCalls.push(`${input.sourceId}:${input.url ?? "source"}`);
    return this.run("embedding");
  }

  async checkTombstones(input: { sourceId: string; url?: string }) {
    this.tombstoneCalls.push(`${input.sourceId}:${input.url ?? "source"}`);
    return this.run("tombstone_check");
  }
}

function createWorker(options: {
  store?: InMemoryWorkerStore;
  executor?: FakeExecutor;
  maxJobsPerRun?: number;
  maxConcurrency?: number;
  runningJobTimeoutSeconds?: number;
} = {}) {
  const store = options.store ?? new InMemoryWorkerStore();
  const queue = new RefreshJobQueue({
    store,
    sourceRegistry: defaultDocsSourceRegistry,
    now: () => now,
    maxPendingJobs: 50,
    maxPendingJobsPerSource: 50
  });
  const executor = options.executor ?? new FakeExecutor();

  return {
    store,
    executor,
    worker: new DocsRefreshWorker({
      store,
      queue,
      executor,
      sourceRegistry: defaultDocsSourceRegistry,
      now: () => now,
      refreshIntervalSeconds: 7 * 24 * 60 * 60,
      maxJobsPerRun: options.maxJobsPerRun ?? 10,
      maxPagesPerRun: 500,
      maxEmbeddingsPerRun: 2000,
      maxConcurrency: options.maxConcurrency ?? 4,
      runningJobTimeoutSeconds: options.runningJobTimeoutSeconds ?? 1800
    })
  };
}

function parseLastError(job: MutableWorkerJob | undefined): {
  code: string;
  message: string;
  details?: Record<string, unknown>;
} {
  if (job?.lastError === undefined || job.lastError === null) {
    throw new Error("Expected job last_error.");
  }

  return JSON.parse(job.lastError) as {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

describe("docs refresh worker", () => {
  test("worker command imports without side effects", async () => {
    const module = await import("../../../../src/docs-worker");

    expect(typeof module.startDocsWorker).toBe("function");
    expect(typeof module.runDocsWorkerOnce).toBe("function");
  });

  test("worker startup seeds configured source rows before queueing refresh jobs", async () => {
    const module = await import("../../../../src/docs-worker");
    const seeded: unknown[] = [];

    await module.seedConfiguredDocsSources({
      async upsertSource(input) {
        seeded.push(input);
      }
    });

    expect(seeded).toContainEqual({
      sourceId: "bun",
      displayName: "Bun Documentation",
      enabled: true,
      allowedUrlPatterns: ["https://bun.com/docs/llms.txt", "https://bun.com/docs/llms-full.txt", "https://bun.com/docs/*"],
      defaultTtlSeconds: 604800
    });
  });

  test("worker processes queued page refresh job", async () => {
    const { store, executor, worker } = createWorker();
    const job = store.seed({ url: pageUrl, jobType: "page", reason: "missing_content" });

    const result = await worker.runOnce();

    expect(result.processed).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(executor.pageCalls).toEqual([`bun:${pageUrl}`]);
    expect(store.jobs.find((item) => item.id === job.id)?.status).toBe("succeeded");
  });

  test("worker processes embedding job", async () => {
    const { store, executor, worker } = createWorker();
    store.seed({ url: pageUrl, jobType: "embedding", reason: "stale_content" });

    const result = await worker.runOnce();

    expect(result.processed).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(executor.embeddingCalls).toEqual([`bun:${pageUrl}`]);
  });

  test("worker marks failed job with structured error", async () => {
    const executor = new FakeExecutor(new Set(["page"]));
    const { store, worker } = createWorker({ executor });
    const job = store.seed({ url: pageUrl, jobType: "page", reason: "missing_content" });

    const result = await worker.runOnce();
    const failed = store.jobs.find((item) => item.id === job.id);

    expect(result.failed).toBe(1);
    expect(failed?.status).toBe("failed");
    expect(failed?.lastError).toContain("fetch_failed");
  });

  test("worker marks thrown execution error failed with sanitized structured last_error", async () => {
    const executor = new FakeExecutor(new Set(), new Set(["page"]));
    const { store, worker } = createWorker({ executor });
    const job = store.seed({ url: pageUrl, jobType: "page", reason: "missing_content" });

    const result = await worker.runOnce();
    const failed = store.jobs.find((item) => item.id === job.id);
    const lastError = parseLastError(failed);

    expect(result.processed).toBe(1);
    expect(result.failed).toBe(1);
    expect(failed?.status).toBe("failed");
    expect(lastError).toEqual({
      code: "internal_error",
      message: "Docs refresh job failed unexpectedly.",
      details: {
        jobId: job.id,
        sourceId: "bun",
        jobType: "page"
      }
    });
    expect(failed?.lastError).not.toContain("secret-token");
    expect(failed?.lastError).not.toContain("Authorization");
    expect(failed?.lastError).not.toContain("full page content");
    expect(failed?.lastError).not.toContain("Error:");
  });

  test("worker continues after one claimed job throws", async () => {
    const executor = new FakeExecutor(new Set(), new Set(["page"]));
    const { store, worker } = createWorker({ executor, maxJobsPerRun: 2, maxConcurrency: 1 });
    const failedJob = store.seed({ url: "https://bun.com/docs/runtime/http-server", jobType: "page" });
    const succeededJob = store.seed({ url: "https://bun.com/docs/runtime/typescript", jobType: "embedding" });

    const result = await worker.runOnce();

    expect(result.processed).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(store.jobs.find((job) => job.id === failedJob.id)?.status).toBe("failed");
    expect(store.jobs.find((job) => job.id === succeededJob.id)?.status).toBe("succeeded");
    expect(executor.embeddingCalls).toEqual(["bun:https://bun.com/docs/runtime/typescript"]);
  });

  test("worker recovers stale running jobs before claiming queued jobs", async () => {
    const { store, worker } = createWorker({ maxJobsPerRun: 2, runningJobTimeoutSeconds: 1800 });
    store.seed({
      jobType: "source_index",
      reason: "scheduled",
      status: "succeeded",
      createdAt: "2026-05-13T00:00:00.000Z"
    });
    const stale = store.seed({
      url: "https://bun.com/docs/runtime/http-server",
      jobType: "page",
      status: "running",
      createdAt: "2026-05-14T11:00:00.000Z",
      startedAt: "2026-05-14T11:00:00.000Z",
      attemptCount: 2
    });
    const queued = store.seed({ url: "https://bun.com/docs/runtime/typescript", jobType: "embedding" });

    const result = await worker.runCycle();
    const recovered = store.jobs.find((job) => job.id === stale.id);
    const lastError = parseLastError(recovered);

    expect(result.recovered).toEqual({ staleRunningFailed: 1 });
    expect(result.processed).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(recovered?.status).toBe("failed");
    expect(store.jobs.find((job) => job.id === queued.id)?.status).toBe("succeeded");
    expect(lastError.details).toMatchObject({
      jobId: stale.id,
      sourceId: "bun",
      jobType: "page",
      attemptCount: 2,
      startedAt: "2026-05-14T11:00:00.000Z",
      timeoutSeconds: 1800,
      ageSeconds: 3600
    });
  });

  test("worker does not recover fresh running jobs", async () => {
    const { store, worker } = createWorker({ runningJobTimeoutSeconds: 1800 });
    store.seed({
      jobType: "source_index",
      reason: "scheduled",
      status: "succeeded",
      createdAt: "2026-05-13T00:00:00.000Z"
    });
    const fresh = store.seed({
      url: "https://bun.com/docs/runtime/http-server",
      jobType: "page",
      status: "running",
      createdAt: "2026-05-14T11:45:00.000Z",
      startedAt: "2026-05-14T11:45:00.000Z",
      attemptCount: 1
    });

    const result = await worker.runCycle();

    expect(result.recovered).toEqual({ staleRunningFailed: 0 });
    expect(result.processed).toBe(0);
    expect(store.jobs.find((job) => job.id === fresh.id)?.status).toBe("running");
  });

  test("worker respects max jobs per run", async () => {
    const { store, worker } = createWorker({ maxJobsPerRun: 2 });
    store.seed({ url: "https://bun.com/docs/runtime/http-server", jobType: "page" });
    store.seed({ url: "https://bun.com/docs/runtime/typescript", jobType: "page" });
    store.seed({ url: "https://bun.com/docs/runtime/imports", jobType: "page" });

    const result = await worker.runOnce();

    expect(result.processed).toBe(2);
    expect(store.jobs.filter((job) => job.status === "queued")).toHaveLength(1);
  });

  test("worker respects concurrency setting", async () => {
    const { store, executor, worker } = createWorker({ maxJobsPerRun: 4, maxConcurrency: 2 });
    store.seed({ url: "https://bun.com/docs/runtime/http-server", jobType: "page" });
    store.seed({ url: "https://bun.com/docs/runtime/typescript", jobType: "page" });
    store.seed({ url: "https://bun.com/docs/runtime/imports", jobType: "page" });
    store.seed({ url: "https://bun.com/docs/runtime/bun-apis", jobType: "page" });

    const result = await worker.runOnce();

    expect(result.processed).toBe(4);
    expect(executor.maxActive).toBeLessThanOrEqual(2);
  });

  test("scheduled refresh enqueues jobs when interval elapsed", async () => {
    const { store, worker } = createWorker();
    store.seed({
      jobType: "source_index",
      reason: "scheduled",
      status: "succeeded",
      createdAt: "2026-05-01T00:00:00.000Z"
    });

    const result = await worker.enqueueScheduledRefresh();

    expect(result.enqueued).toBe(1);
    expect(store.jobs.filter((job) => job.jobType === "source_index" && job.status === "queued")).toHaveLength(1);
  });

  test("scheduled refresh does not enqueue when interval has not elapsed", async () => {
    const { store, worker } = createWorker();
    store.seed({
      jobType: "source_index",
      reason: "scheduled",
      status: "succeeded",
      createdAt: "2026-05-13T00:00:00.000Z"
    });

    const result = await worker.enqueueScheduledRefresh();

    expect(result.enqueued).toBe(0);
    expect(store.jobs.filter((job) => job.jobType === "source_index" && job.status === "queued")).toHaveLength(0);
  });

  test("scheduled refresh helper uses configured interval", () => {
    expect(
      shouldEnqueueScheduledRefresh({
        latestJob: null,
        now,
        refreshIntervalSeconds: 7 * 24 * 60 * 60
      })
    ).toBe(true);
    expect(
      shouldEnqueueScheduledRefresh({
        latestJob: { createdAt: "2026-05-13T00:00:00.000Z", finishedAt: "2026-05-13T00:00:00.000Z" },
        now,
        refreshIntervalSeconds: 7 * 24 * 60 * 60
      })
    ).toBe(false);
  });
});
