import type { AdminActionResult } from "@bun-dev-intel/admin-contracts";
import type {
  CreateRefreshJobInput,
  RefreshJob,
  RefreshJobReason,
  RefreshJobStatus,
  RefreshJobType,
  SqlClient
} from "@bun-dev-intel/db";
import type { AdminPrincipal } from "../auth";
import type { EnqueueRefreshJobResult } from "@bun-dev-intel/docs-domain/docs/refresh/refresh-queue";

type ActionErrorStatus = 400 | 404 | 503;

export type AdminActionStoredJob = RefreshJob;

export interface AdminActionRequestContext {
  readonly actor: AdminPrincipal;
  readonly now: string;
}

export interface AdminActionQueue {
  readonly enqueue: (input: {
    readonly sourceId: string;
    readonly url?: string;
    readonly jobType: RefreshJobType;
    readonly reason: RefreshJobReason;
  }) => Promise<EnqueueRefreshJobResult>;
}

export interface AdminActionAuditInput {
  readonly actorUserId: number | null;
  readonly eventType: string;
  readonly targetType: string | null;
  readonly targetId: string | null;
  readonly details: Record<string, unknown>;
  readonly now: string;
}

export interface AdminActionAuditEvent {
  readonly id: number;
  readonly actorUserId: number | null;
  readonly eventType: string;
  readonly targetType: string | null;
  readonly targetId: string | null;
  readonly details: Record<string, unknown>;
  readonly createdAt: string;
}

export interface AdminActionStore {
  readonly getRefreshJob: (jobId: number) => Promise<AdminActionStoredJob | null>;
  readonly createRefreshJob: (input: CreateRefreshJobInput) => Promise<AdminActionStoredJob>;
  readonly tombstoneSourcePages: (input: { readonly sourceId: string; readonly reason: string; readonly now: string }) => Promise<number>;
  readonly createAuditEvent: (input: AdminActionAuditInput) => Promise<AdminActionAuditEvent>;
}

export interface AdminActionService {
  readonly refreshSource: (input: { readonly sourceId: string } & AdminActionRequestContext) => Promise<AdminActionResult>;
  readonly retryJob: (input: { readonly jobId: number } & AdminActionRequestContext) => Promise<AdminActionResult>;
  readonly tombstoneSource: (
    input: { readonly sourceId: string; readonly confirmation: string; readonly reason?: string } & AdminActionRequestContext
  ) => Promise<AdminActionResult>;
  readonly purgeReindexSource: (
    input: { readonly sourceId: string; readonly confirmation: string } & AdminActionRequestContext
  ) => Promise<AdminActionResult>;
}

interface AdminActionsServiceOptions {
  readonly store: AdminActionStore;
  readonly queue: AdminActionQueue;
}

interface RefreshJobRow extends Record<string, unknown> {
  readonly id: number;
  readonly source_id: string;
  readonly url: string | null;
  readonly job_type: RefreshJobType;
  readonly reason: RefreshJobReason;
  readonly status: RefreshJobStatus;
  readonly priority: number;
  readonly run_after: string;
  readonly attempt_count: number;
  readonly last_error: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly finished_at: string | null;
}

interface AuditEventRow extends Record<string, unknown> {
  readonly id: number;
  readonly actor_user_id: number | null;
  readonly event_type: string;
  readonly target_type: string | null;
  readonly target_id: string | null;
  readonly details: Record<string, unknown>;
  readonly created_at: string;
}

export class AdminActionError extends Error {
  readonly status: ActionErrorStatus;
  readonly code: string;

  constructor(status: ActionErrorStatus, code: string, message: string) {
    super(message);
    this.name = "AdminActionError";
    this.status = status;
    this.code = code;
  }
}

export function isAdminActionError(error: unknown): error is AdminActionError {
  return error instanceof AdminActionError;
}

export class AdminActionsService implements AdminActionService {
  private readonly store: AdminActionStore;
  private readonly queue: AdminActionQueue;

  constructor(options: AdminActionsServiceOptions) {
    this.store = options.store;
    this.queue = options.queue;
  }

  async refreshSource(input: { readonly sourceId: string } & AdminActionRequestContext): Promise<AdminActionResult> {
    const queued = await this.enqueueSourceRefresh(input.sourceId);
    const audit = await this.audit({
      actor: input.actor,
      eventType: "admin.source.refresh",
      targetType: "source",
      targetId: input.sourceId,
      now: input.now,
      details: {
        status: queued.status,
        queuedJobId: queued.queuedJobId
      }
    });

    return {
      actionType: "source_refresh",
      status: queued.status,
      sourceId: input.sourceId,
      jobId: null,
      queuedJobId: queued.queuedJobId,
      affectedPages: null,
      auditEventId: audit.id,
      message: queued.message
    };
  }

  async retryJob(input: { readonly jobId: number } & AdminActionRequestContext): Promise<AdminActionResult> {
    const job = await this.store.getRefreshJob(input.jobId);

    if (job === null) {
      throw new AdminActionError(404, "not_found", "Refresh job was not found.");
    }

    if (job.status !== "failed") {
      throw new AdminActionError(400, "job_not_failed", "Only failed refresh jobs can be retried.");
    }

    const retried = await this.store.createRefreshJob({
      sourceId: job.sourceId,
      ...(job.url === null ? {} : { url: job.url }),
      jobType: job.jobType,
      reason: "manual",
      priority: job.priority,
      runAfter: input.now
    });
    const audit = await this.audit({
      actor: input.actor,
      eventType: "admin.job.retry",
      targetType: "job",
      targetId: String(job.id),
      now: input.now,
      details: {
        status: "retried",
        sourceId: job.sourceId,
        originalJobId: job.id,
        queuedJobId: retried.id
      }
    });

    return {
      actionType: "job_retry",
      status: "retried",
      sourceId: job.sourceId,
      jobId: job.id,
      queuedJobId: retried.id,
      affectedPages: null,
      auditEventId: audit.id,
      message: "Failed job retry queued."
    };
  }

  async tombstoneSource(
    input: { readonly sourceId: string; readonly confirmation: string; readonly reason?: string } & AdminActionRequestContext
  ): Promise<AdminActionResult> {
    assertSourceConfirmation(input.sourceId, input.confirmation);
    const reason = normalizeReason(input.reason, "admin tombstone");
    const affectedPages = await this.store.tombstoneSourcePages({
      sourceId: input.sourceId,
      reason,
      now: input.now
    });
    const audit = await this.audit({
      actor: input.actor,
      eventType: "admin.source.tombstone",
      targetType: "source",
      targetId: input.sourceId,
      now: input.now,
      details: {
        status: "tombstoned",
        affectedPages,
        reason
      }
    });

    return {
      actionType: "source_tombstone",
      status: "tombstoned",
      sourceId: input.sourceId,
      jobId: null,
      queuedJobId: null,
      affectedPages,
      auditEventId: audit.id,
      message: "Source pages tombstoned."
    };
  }

  async purgeReindexSource(
    input: { readonly sourceId: string; readonly confirmation: string } & AdminActionRequestContext
  ): Promise<AdminActionResult> {
    assertSourceConfirmation(input.sourceId, input.confirmation);
    const reason = "admin purge and reindex";
    const affectedPages = await this.store.tombstoneSourcePages({
      sourceId: input.sourceId,
      reason,
      now: input.now
    });
    const queued = await this.enqueueSourceRefresh(input.sourceId);
    const status = queued.status === "queued" ? "purge_reindex_queued" : queued.status;
    const audit = await this.audit({
      actor: input.actor,
      eventType: "admin.source.purge_reindex",
      targetType: "source",
      targetId: input.sourceId,
      now: input.now,
      details: {
        status,
        affectedPages,
        queuedJobId: queued.queuedJobId
      }
    });

    return {
      actionType: "source_purge_reindex",
      status,
      sourceId: input.sourceId,
      jobId: null,
      queuedJobId: queued.queuedJobId,
      affectedPages,
      auditEventId: audit.id,
      message: status === "purge_reindex_queued" ? "Source tombstoned and reindex queued." : queued.message
    };
  }

  private async enqueueSourceRefresh(sourceId: string): Promise<{
    readonly status: "queued" | "deduplicated" | "skipped_bounds";
    readonly queuedJobId: number | null;
    readonly message: string;
  }> {
    const result = await this.queue.enqueue({
      sourceId,
      jobType: "source_index",
      reason: "manual"
    });

    if (result.status === "rejected_policy") {
      throw new AdminActionError(400, "disallowed_source", result.error.message);
    }

    if (result.status === "skipped_bounds") {
      return {
        status: "skipped_bounds",
        queuedJobId: null,
        message: `Source refresh was not queued because the ${result.reason.replaceAll("_", " ")} was reached.`
      };
    }

    return {
      status: result.status,
      queuedJobId: result.job.id,
      message: result.status === "queued" ? "Source refresh queued." : "A source refresh is already pending."
    };
  }

  private async audit(input: {
    readonly actor: AdminPrincipal;
    readonly eventType: string;
    readonly targetType: string;
    readonly targetId: string;
    readonly details: Record<string, unknown>;
    readonly now: string;
  }): Promise<AdminActionAuditEvent> {
    return this.store.createAuditEvent({
      actorUserId: input.actor.id,
      eventType: input.eventType,
      targetType: input.targetType,
      targetId: input.targetId,
      details: {
        ...input.details,
        actorEmail: input.actor.email
      },
      now: input.now
    });
  }
}

export class PostgresAdminActionStore implements AdminActionStore {
  private readonly sql: SqlClient;

  constructor(sql: SqlClient) {
    this.sql = sql;
  }

  async getRefreshJob(jobId: number): Promise<AdminActionStoredJob | null> {
    const rows = await this.sql<RefreshJobRow[]>`
      select
        id,
        source_id,
        url,
        job_type,
        reason,
        status,
        priority,
        run_after::text as run_after,
        attempt_count,
        last_error,
        created_at::text as created_at,
        updated_at::text as updated_at,
        finished_at::text as finished_at
      from doc_refresh_jobs
      where id = ${jobId}
      limit 1
    `;

    return rows[0] === undefined ? null : mapRefreshJob(rows[0]);
  }

  async createRefreshJob(input: CreateRefreshJobInput): Promise<AdminActionStoredJob> {
    const rows = await this.sql<RefreshJobRow[]>`
      insert into doc_refresh_jobs (source_id, url, job_type, reason, priority, run_after)
      values (${input.sourceId}, ${input.url ?? null}, ${input.jobType}, ${input.reason}, ${input.priority}, ${input.runAfter ?? new Date().toISOString()})
      returning
        id,
        source_id,
        url,
        job_type,
        reason,
        status,
        priority,
        run_after::text as run_after,
        attempt_count,
        last_error,
        created_at::text as created_at,
        updated_at::text as updated_at,
        finished_at::text as finished_at
    `;
    const row = rows[0];

    if (row === undefined) {
      throw new Error("Expected refresh job insert to return a row.");
    }

    return mapRefreshJob(row);
  }

  async tombstoneSourcePages(input: { readonly sourceId: string; readonly reason: string; readonly now: string }): Promise<number> {
    const rows = await this.sql<Array<{ id: number }>>`
      update doc_pages
      set
        tombstoned_at = ${input.now},
        tombstone_reason = ${input.reason},
        updated_at = ${input.now}
      where source_id = ${input.sourceId}
        and tombstoned_at is null
      returning id
    `;

    return rows.length;
  }

  async createAuditEvent(input: AdminActionAuditInput): Promise<AdminActionAuditEvent> {
    const details = JSON.stringify(input.details);
    const rows = await this.sql<AuditEventRow[]>`
      insert into admin_audit_events (actor_user_id, event_type, target_type, target_id, details, created_at)
      values (${input.actorUserId}, ${input.eventType}, ${input.targetType}, ${input.targetId}, ${details}::jsonb, ${input.now})
      returning
        id,
        actor_user_id,
        event_type,
        target_type,
        target_id,
        details,
        created_at::text as created_at
    `;
    const row = rows[0];

    if (row === undefined) {
      throw new Error("Expected audit event insert to return a row.");
    }

    return {
      id: Number(row.id),
      actorUserId: row.actor_user_id === null ? null : Number(row.actor_user_id),
      eventType: row.event_type,
      targetType: row.target_type,
      targetId: row.target_id,
      details: row.details,
      createdAt: toIsoString(row.created_at) ?? row.created_at
    };
  }
}

function assertSourceConfirmation(sourceId: string, confirmation: string): void {
  if (confirmation.trim() !== sourceId) {
    throw new AdminActionError(400, "confirmation_mismatch", "Typed source ID confirmation did not match.");
  }
}

function normalizeReason(value: string | undefined, fallback: string): string {
  const normalized = value?.trim();
  return normalized === undefined || normalized.length === 0 ? fallback : normalized;
}

function toIsoString(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? value : new Date(timestamp).toISOString();
}

function mapRefreshJob(row: RefreshJobRow): AdminActionStoredJob {
  return {
    id: Number(row.id),
    sourceId: row.source_id,
    url: row.url,
    jobType: row.job_type,
    reason: row.reason,
    status: row.status,
    priority: Number(row.priority),
    runAfter: toIsoString(row.run_after) ?? row.run_after,
    attemptCount: Number(row.attempt_count),
    lastError: row.last_error,
    createdAt: toIsoString(row.created_at) ?? row.created_at,
    updatedAt: toIsoString(row.updated_at) ?? row.updated_at,
    finishedAt: toIsoString(row.finished_at)
  };
}
