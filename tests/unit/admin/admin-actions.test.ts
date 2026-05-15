import { describe, expect, test } from "bun:test";
import {
  AdminActionsService,
  type AdminActionAuditEvent,
  type AdminActionAuditInput,
  type AdminActionQueue,
  type AdminActionStore,
  type AdminActionStoredJob
} from "../../../apps/admin-console/server/src/actions";

const now = "2026-05-15T12:00:00.000Z";
const actor = {
  id: 1,
  email: "admin@example.com",
  role: "admin" as const
};

describe("admin actions service", () => {
  test("source refresh enqueues a manual source job and writes an audit event", async () => {
    const store = new MemoryActionStore();
    const queue = new FakeActionQueue();
    const service = new AdminActionsService({ store, queue });

    const result = await service.refreshSource({ sourceId: "bun", actor, now });

    expect(queue.calls).toEqual([
      {
        sourceId: "bun",
        jobType: "source_index",
        reason: "manual"
      }
    ]);
    expect(result).toMatchObject({
      actionType: "source_refresh",
      status: "queued",
      sourceId: "bun",
      queuedJobId: 101,
      auditEventId: 1
    });
    expect(store.auditEvents[0]).toMatchObject({
      actorUserId: 1,
      eventType: "admin.source.refresh",
      targetType: "source",
      targetId: "bun",
      details: {
        status: "queued",
        queuedJobId: 101
      }
    });
  });

  test("retry creates a new queued job and leaves the original failed job unchanged", async () => {
    const store = new MemoryActionStore();
    const service = new AdminActionsService({ store, queue: new FakeActionQueue() });
    const original = store.jobs.get(7);

    const result = await service.retryJob({ jobId: 7, actor, now });

    expect(original?.status).toBe("failed");
    expect(store.createdJobs).toEqual([
      {
        sourceId: "bun",
        url: "https://bun.com/docs/runtime",
        jobType: "page",
        reason: "manual",
        priority: 10,
        runAfter: now
      }
    ]);
    expect(result).toMatchObject({
      actionType: "job_retry",
      status: "retried",
      jobId: 7,
      queuedJobId: 201,
      auditEventId: 1
    });
  });

  test("tombstone marks all source pages with an admin reason and audits the outcome", async () => {
    const store = new MemoryActionStore();
    const service = new AdminActionsService({ store, queue: new FakeActionQueue() });

    const result = await service.tombstoneSource({
      sourceId: "bun",
      confirmation: "bun",
      reason: "retired docs source",
      actor,
      now
    });

    expect(store.tombstoneCalls).toEqual([
      {
        sourceId: "bun",
        reason: "retired docs source",
        now
      }
    ]);
    expect(result).toMatchObject({
      actionType: "source_tombstone",
      status: "tombstoned",
      affectedPages: 2,
      auditEventId: 1
    });
  });

  test("purge/reindex tombstones the source and enqueues a manual refresh", async () => {
    const store = new MemoryActionStore();
    const queue = new FakeActionQueue();
    const service = new AdminActionsService({ store, queue });

    const result = await service.purgeReindexSource({
      sourceId: "bun",
      confirmation: "bun",
      actor,
      now
    });

    expect(store.tombstoneCalls).toEqual([
      {
        sourceId: "bun",
        reason: "admin purge and reindex",
        now
      }
    ]);
    expect(queue.calls).toEqual([
      {
        sourceId: "bun",
        jobType: "source_index",
        reason: "manual"
      }
    ]);
    expect(result).toMatchObject({
      actionType: "source_purge_reindex",
      status: "purge_reindex_queued",
      affectedPages: 2,
      queuedJobId: 101,
      auditEventId: 1
    });
  });
});

class FakeActionQueue implements AdminActionQueue {
  calls: unknown[] = [];

  async enqueue(input: Parameters<AdminActionQueue["enqueue"]>[0]) {
    this.calls.push(input);

    return {
      status: "queued" as const,
      job: {
        id: 101,
        sourceId: input.sourceId,
        url: null,
        jobType: input.jobType,
        reason: input.reason,
        status: "queued" as const,
        priority: 50,
        runAfter: now
      },
      priority: 50,
      runAfter: now
    };
  }
}

class MemoryActionStore implements AdminActionStore {
  jobs = new Map<number, AdminActionStoredJob>([
    [
      7,
      {
        id: 7,
        sourceId: "bun",
        url: "https://bun.com/docs/runtime",
        jobType: "page",
        reason: "missing_content",
        status: "failed",
        priority: 10,
        runAfter: now,
        attemptCount: 1,
        lastError: "timeout",
        createdAt: now,
        updatedAt: now,
        finishedAt: now
      }
    ]
  ]);
  auditEvents: AdminActionAuditInput[] = [];
  createdJobs: Parameters<AdminActionStore["createRefreshJob"]>[0][] = [];
  tombstoneCalls: Parameters<AdminActionStore["tombstoneSourcePages"]>[0][] = [];
  private nextJobId = 201;
  private nextAuditId = 1;

  async getRefreshJob(jobId: number): Promise<AdminActionStoredJob | null> {
    return this.jobs.get(jobId) ?? null;
  }

  async createRefreshJob(input: Parameters<AdminActionStore["createRefreshJob"]>[0]): Promise<AdminActionStoredJob> {
    this.createdJobs.push(input);
    const job: AdminActionStoredJob = {
      id: this.nextJobId++,
      sourceId: input.sourceId,
      url: input.url ?? null,
      jobType: input.jobType,
      reason: input.reason,
      status: "queued",
      priority: input.priority,
      runAfter: input.runAfter ?? now,
      attemptCount: 0,
      lastError: null,
      createdAt: now,
      updatedAt: now,
      finishedAt: null
    };
    this.jobs.set(job.id, job);
    return job;
  }

  async tombstoneSourcePages(input: Parameters<AdminActionStore["tombstoneSourcePages"]>[0]): Promise<number> {
    this.tombstoneCalls.push(input);
    return 2;
  }

  async createAuditEvent(input: AdminActionAuditInput): Promise<AdminActionAuditEvent> {
    this.auditEvents.push(input);
    return {
      id: this.nextAuditId++,
      actorUserId: input.actorUserId,
      eventType: input.eventType,
      targetType: input.targetType,
      targetId: input.targetId,
      details: input.details,
      createdAt: input.now
    };
  }
}
