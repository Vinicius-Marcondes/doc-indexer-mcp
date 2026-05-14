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
  finishedAt: string | null;
  attemptCount: number;
};

class InMemoryWorkerStore implements DocsRefreshWorkerStore {
  readonly jobs: MutableWorkerJob[] = [];
  nextId = 1;

  seed(input: Partial<CreateRefreshJobInput> & { status?: MutableWorkerJob["status"]; createdAt?: string } = {}) {
    const job: MutableWorkerJob = {
      id: this.nextId,
      sourceId: input.sourceId ?? "bun",
      url: input.url ?? null,
      jobType: input.jobType ?? "page",
      reason: input.reason ?? "missing_content",
      status: input.status ?? "queued",
      priority: input.priority ?? 50,
      runAfter: input.runAfter ?? now,
      createdAt: input.createdAt ?? now,
      updatedAt: input.createdAt ?? now,
      finishedAt: input.status === "succeeded" || input.status === "failed" ? input.createdAt ?? now : null,
      attemptCount: 0
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
    if (input.status === "succeeded" || input.status === "failed") {
      job.finishedAt = input.now ?? now;
    }
    return job;
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

  constructor(private readonly failJobTypes = new Set<RefreshJobType>()) {}

  private async run(jobType: RefreshJobType): Promise<{ ok: true } | { ok: false; error: ReturnType<typeof createStructuredError> }> {
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    this.active -= 1;

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
      maxConcurrency: options.maxConcurrency ?? 4
    })
  };
}

describe("docs refresh worker", () => {
  test("worker command imports without side effects", async () => {
    const module = await import("../../../../src/docs-worker");

    expect(typeof module.startDocsWorker).toBe("function");
    expect(typeof module.runDocsWorkerOnce).toBe("function");
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
