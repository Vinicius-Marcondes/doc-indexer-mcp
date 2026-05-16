import { describe, expect, test } from "bun:test";
import {
  RefreshJobQueue,
  computeRefreshPriority,
  type RefreshQueueStore,
  type RefreshQueueStoredJob
} from "../../../../packages/docs-domain/src/docs/refresh/refresh-queue";
import type { CreateRefreshJobInput, RefreshJobReason, RefreshJobType } from "../../../../packages/docs-domain/src/docs/storage/docs-storage";
import { defaultDocsSourceRegistry } from "../../../../packages/docs-domain/src/docs/sources/bun-source-pack";

const now = "2026-05-14T12:00:00.000Z";

class InMemoryRefreshStore implements RefreshQueueStore {
  readonly jobs: RefreshQueueStoredJob[] = [];
  nextId = 1;

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
    const job: RefreshQueueStoredJob = {
      id: this.nextId,
      sourceId: input.sourceId,
      url: input.url ?? null,
      jobType: input.jobType,
      reason: input.reason,
      status: "queued",
      priority: input.priority,
      runAfter: input.runAfter ?? now
    };
    this.nextId += 1;
    this.jobs.push(job);
    return job;
  }

  async updateRefreshJobStatus(input: {
    id: number;
    status: "succeeded" | "failed" | "running" | "queued";
    lastError?: string;
  }): Promise<void> {
    const job = this.jobs.find((item) => item.id === input.id);
    if (job !== undefined) {
      job.status = input.status;
      job.lastError = input.lastError;
    }
  }
}

function createQueue(store = new InMemoryRefreshStore()) {
  return {
    store,
    queue: new RefreshJobQueue({
      store,
      sourceRegistry: defaultDocsSourceRegistry,
      now: () => now,
      maxPendingJobs: 3,
      maxPendingJobsPerSource: 2
    })
  };
}

describe("refresh job queue", () => {
  test("enqueues missing page job", async () => {
    const { queue, store } = createQueue();
    const result = await queue.enqueue({
      sourceId: "bun",
      url: "https://bun.com/docs/runtime/http-server",
      jobType: "page",
      reason: "missing_content"
    });

    expect(result.status).toBe("queued");
    if (result.status !== "queued") {
      throw new Error("Expected queued refresh job.");
    }
    expect(result.job.sourceId).toBe("bun");
    expect(result.job.url).toBe("https://bun.com/docs/runtime/http-server");
    expect(store.jobs).toHaveLength(1);
  });

  test("deduplicates same pending job", async () => {
    const { queue, store } = createQueue();
    await queue.enqueue({
      sourceId: "bun",
      url: "https://bun.com/docs/runtime/http-server",
      jobType: "page",
      reason: "missing_content"
    });
    const duplicate = await queue.enqueue({
      sourceId: "bun",
      url: "https://bun.com/docs/runtime/http-server",
      jobType: "page",
      reason: "stale_content"
    });

    expect(duplicate.status).toBe("deduplicated");
    expect(store.jobs).toHaveLength(1);
  });

  test("allows new job after previous succeeds or fails according to policy", async () => {
    const { queue, store } = createQueue();
    const first = await queue.enqueue({
      sourceId: "bun",
      url: "https://bun.com/docs/runtime/http-server",
      jobType: "page",
      reason: "missing_content"
    });

    if (first.status !== "queued") {
      throw new Error("Expected first job to queue.");
    }

    await store.updateRefreshJobStatus({ id: first.job.id, status: "succeeded" });
    const second = await queue.enqueue({
      sourceId: "bun",
      url: "https://bun.com/docs/runtime/http-server",
      jobType: "page",
      reason: "stale_content"
    });

    expect(second.status).toBe("queued");
    expect(store.jobs).toHaveLength(2);
  });

  test("rejects disallowed URL", async () => {
    const { queue, store } = createQueue();
    const result = await queue.enqueue({
      sourceId: "bun",
      url: "https://example.com/docs/runtime",
      jobType: "page",
      reason: "missing_content"
    });

    expect(result.status).toBe("rejected_policy");
    if (result.status !== "rejected_policy") {
      throw new Error("Expected disallowed URL to be rejected.");
    }
    expect(result.error.code).toBe("disallowed_source");
    expect(store.jobs).toHaveLength(0);
  });

  test("priority increases with age, access, stale hits, and low-confidence searches", () => {
    const low = computeRefreshPriority({});
    const high = computeRefreshPriority({
      contentAgeHours: 24 * 14,
      recentRequestCount: 10,
      staleHitCount: 3,
      lowConfidenceSearchCount: 5
    });

    expect(high).toBeGreaterThan(low);
  });

  test("recent failure lowers priority and delays job", async () => {
    const { queue } = createQueue();
    const result = await queue.enqueue({
      sourceId: "bun",
      url: "https://bun.com/docs/runtime/http-server",
      jobType: "page",
      reason: "stale_content",
      prioritySignals: {
        contentAgeHours: 48,
        recentFailureCount: 2
      }
    });

    expect(result.status).toBe("queued");
    if (result.status !== "queued") {
      throw new Error("Expected failure-delayed job to queue.");
    }
    expect(result.priority).toBeLessThan(computeRefreshPriority({ contentAgeHours: 48 }));
    expect(Date.parse(result.runAfter)).toBeGreaterThan(Date.parse(now));
  });

  test("queue bounds are enforced", async () => {
    const { queue } = createQueue();

    await queue.enqueue({ sourceId: "bun", jobType: "source_index", reason: "scheduled" });
    await queue.enqueue({
      sourceId: "bun",
      url: "https://bun.com/docs/runtime/http-server",
      jobType: "page",
      reason: "missing_content"
    });
    const bounded = await queue.enqueue({
      sourceId: "bun",
      url: "https://bun.com/docs/runtime/typescript",
      jobType: "page",
      reason: "missing_content"
    });

    expect(bounded.status).toBe("skipped_bounds");
    if (bounded.status !== "skipped_bounds") {
      throw new Error("Expected per-source bounds to skip enqueue.");
    }
    expect(bounded.reason).toBe("per_source_limit");
  });
});
