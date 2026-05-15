import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArchiveX, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import type {
  AdminActionResult,
  AdminChunkDetail,
  AdminConfirmedSourceActionRequest,
  AdminJobSummary,
  AdminPageDetail,
  AdminPageListItem,
  AdminRole,
  AdminSourceHealth
} from "@bun-dev-intel/admin-contracts";
import { useAdminApi, useAdminSession } from "./session";
import type { AdminJobListOptions, AdminPageListOptions } from "./api-client";

const pageLimit = 25;
const jobLimit = 50;

export function SourcesPage() {
  const api = useAdminApi();
  const sourcesQuery = useQuery({
    queryKey: ["admin", "sources", "list"],
    queryFn: () => api.listSources()
  });

  return (
    <PageFrame title="Sources">
      {sourcesQuery.isLoading ? <InlineState tone="neutral" title="Loading sources" /> : null}
      {sourcesQuery.isError ? <InlineState tone="danger" title="Sources failed to load" /> : null}
      {sourcesQuery.data === undefined ? null : <SourcesTable sources={sourcesQuery.data} />}
    </PageFrame>
  );
}

export function SourceDetailPage() {
  const api = useAdminApi();
  const session = useAdminSession();
  const queryClient = useQueryClient();
  const params = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const sourceId = params.sourceId ?? "";
  const pageFilters = pageFiltersFromSearchParams(sourceId, searchParams);
  const sourceQuery = useQuery({
    queryKey: ["admin", "sources", sourceId],
    queryFn: () => api.getSource(sourceId),
    enabled: sourceId.length > 0
  });
  const pagesQuery = useQuery({
    queryKey: ["admin", "sources", sourceId, "pages", pageFilters],
    queryFn: () => api.listPages(pageFilters),
    enabled: sourceId.length > 0
  });
  const jobsQuery = useQuery({
    queryKey: ["admin", "sources", sourceId, "jobs"],
    queryFn: () => api.listJobs({ sourceId, limit: 5 }),
    enabled: sourceId.length > 0
  });
  const refreshMutation = useMutation({
    mutationFn: () => api.refreshSource(sourceId),
    onSuccess: () => invalidateAdminActionQueries(queryClient, { sourceId })
  });
  const tombstoneMutation = useMutation({
    mutationFn: (input: AdminConfirmedSourceActionRequest) => api.tombstoneSource(sourceId, input),
    onSuccess: () => invalidateAdminActionQueries(queryClient, { sourceId })
  });
  const purgeReindexMutation = useMutation({
    mutationFn: (input: Pick<AdminConfirmedSourceActionRequest, "confirmation">) => api.purgeReindexSource(sourceId, input),
    onSuccess: () => invalidateAdminActionQueries(queryClient, { sourceId })
  });

  if (sourceId.length === 0) {
    return <PageFrame title="Source"><InlineState tone="danger" title="Missing source ID" /></PageFrame>;
  }

  return (
    <PageFrame title={`Source: ${sourceId}`}>
      {sourceQuery.isLoading ? <InlineState tone="neutral" title="Loading source" /> : null}
      {sourceQuery.isError ? <InlineState tone="danger" title="Source failed to load" /> : null}
      {sourceQuery.data === undefined ? null : (
        <>
          <SourceSummary source={sourceQuery.data} />
          <SourceActionsPanel
            source={sourceQuery.data}
            userRole={session.data?.role ?? "viewer"}
            refreshAction={{
              isPending: refreshMutation.isPending,
              message: actionMessage(refreshMutation.data),
              error: actionErrorMessage(refreshMutation.error),
              run: () => refreshMutation.mutate()
            }}
            tombstoneAction={{
              isPending: tombstoneMutation.isPending,
              message: actionMessage(tombstoneMutation.data),
              error: actionErrorMessage(tombstoneMutation.error),
              run: (input) => tombstoneMutation.mutate(input)
            }}
            purgeReindexAction={{
              isPending: purgeReindexMutation.isPending,
              message: actionMessage(purgeReindexMutation.data),
              error: actionErrorMessage(purgeReindexMutation.error),
              run: (input) => purgeReindexMutation.mutate(input)
            }}
          />
        </>
      )}
      <section className="split-section">
        <div>
          <SectionHeader title="Pages" />
          <PageFiltersForm key={searchParams.toString()} filters={pageFilters} onSubmit={(next) => setSearchParams(next)} />
          {pagesQuery.isLoading ? <InlineState tone="neutral" title="Loading pages" /> : null}
          {pagesQuery.isError ? <InlineState tone="danger" title="Pages failed to load" /> : null}
          {pagesQuery.data === undefined ? null : (
            <>
              <PagesTable sourceId={sourceId} pages={pagesQuery.data.pages} />
              <PaginationLink nextCursor={pagesQuery.data.nextCursor} searchParams={searchParams} />
            </>
          )}
        </div>
        <div>
          <SectionHeader title="Recent jobs" />
          {jobsQuery.isLoading ? <InlineState tone="neutral" title="Loading jobs" /> : null}
          {jobsQuery.isError ? <InlineState tone="danger" title="Jobs failed to load" /> : null}
          {jobsQuery.data === undefined ? null : <JobsTable jobs={jobsQuery.data.jobs} compact />}
        </div>
      </section>
    </PageFrame>
  );
}

export function PageDetailPage() {
  const api = useAdminApi();
  const params = useParams();
  const sourceId = params.sourceId ?? "";
  const pageId = parseRouteId(params.pageId);
  const pageQuery = useQuery({
    queryKey: ["admin", "sources", sourceId, "pages", pageId],
    queryFn: () => api.getPage(sourceId, pageId ?? -1),
    enabled: sourceId.length > 0 && pageId !== null
  });

  if (sourceId.length === 0 || pageId === null) {
    return <PageFrame title="Page"><InlineState tone="danger" title="Invalid page route" /></PageFrame>;
  }

  return (
    <PageFrame title="Page Detail">
      {pageQuery.isLoading ? <InlineState tone="neutral" title="Loading page" /> : null}
      {pageQuery.isError ? <InlineState tone="danger" title="Page failed to load" /> : null}
      {pageQuery.data === undefined ? null : <PageDetailView page={pageQuery.data} />}
    </PageFrame>
  );
}

export function ChunkDetailPage() {
  const api = useAdminApi();
  const params = useParams();
  const sourceId = params.sourceId ?? "";
  const chunkId = parseRouteId(params.chunkId);
  const chunkQuery = useQuery({
    queryKey: ["admin", "sources", sourceId, "chunks", chunkId],
    queryFn: () => api.getChunk(sourceId, chunkId ?? -1),
    enabled: sourceId.length > 0 && chunkId !== null
  });

  if (sourceId.length === 0 || chunkId === null) {
    return <PageFrame title="Chunk"><InlineState tone="danger" title="Invalid chunk route" /></PageFrame>;
  }

  return (
    <PageFrame title="Chunk Detail">
      {chunkQuery.isLoading ? <InlineState tone="neutral" title="Loading chunk" /> : null}
      {chunkQuery.isError ? <InlineState tone="danger" title="Chunk failed to load" /> : null}
      {chunkQuery.data === undefined ? null : <ChunkDetailView chunk={chunkQuery.data} />}
    </PageFrame>
  );
}

export function JobsPage() {
  const api = useAdminApi();
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = jobFiltersFromSearchParams(searchParams);
  const jobsQuery = useQuery({
    queryKey: ["admin", "jobs", filters],
    queryFn: () => api.listJobs(filters)
  });

  return (
    <PageFrame title="Jobs">
      <JobsFiltersForm key={searchParams.toString()} filters={filters} onSubmit={(next) => setSearchParams(next)} />
      {jobsQuery.isLoading ? <InlineState tone="neutral" title="Loading jobs" /> : null}
      {jobsQuery.isError ? <InlineState tone="danger" title="Jobs failed to load" /> : null}
      {jobsQuery.data === undefined ? null : (
        <>
          <JobsTable jobs={jobsQuery.data.jobs} />
          <PaginationLink nextCursor={jobsQuery.data.nextCursor} searchParams={searchParams} />
        </>
      )}
    </PageFrame>
  );
}

export function JobDetailPage() {
  const api = useAdminApi();
  const session = useAdminSession();
  const queryClient = useQueryClient();
  const params = useParams();
  const jobId = parseRouteId(params.jobId);
  const jobQuery = useQuery({
    queryKey: ["admin", "jobs", jobId],
    queryFn: () => api.getJob(jobId ?? -1),
    enabled: jobId !== null
  });
  const retryMutation = useMutation({
    mutationFn: () => api.retryJob(jobId ?? -1),
    onSuccess: () => invalidateAdminActionQueries(queryClient, { sourceId: jobQuery.data?.sourceId, jobId: jobId ?? undefined })
  });

  if (jobId === null) {
    return <PageFrame title="Job"><InlineState tone="danger" title="Invalid job route" /></PageFrame>;
  }

  return (
    <PageFrame title="Job Detail">
      {jobQuery.isLoading ? <InlineState tone="neutral" title="Loading job" /> : null}
      {jobQuery.isError ? <InlineState tone="danger" title="Job failed to load" /> : null}
      {jobQuery.data === undefined ? null : (
        <>
          <JobDetailView job={jobQuery.data} />
          <JobActionsPanel
            job={jobQuery.data}
            userRole={session.data?.role ?? "viewer"}
            retryAction={{
              isPending: retryMutation.isPending,
              message: actionMessage(retryMutation.data),
              error: actionErrorMessage(retryMutation.error),
              run: () => retryMutation.mutate()
            }}
          />
        </>
      )}
    </PageFrame>
  );
}

export function SourcesTable(props: { readonly sources: readonly AdminSourceHealth[] }) {
  if (props.sources.length === 0) {
    return <InlineState tone="neutral" title="No sources loaded" />;
  }

  return (
    <div className="table-frame">
      <table>
        <thead>
          <tr>
            <th>Source</th>
            <th>State</th>
            <th>Pages</th>
            <th>Chunks</th>
            <th>Embedding coverage</th>
            <th>Stale</th>
            <th>Tombstoned</th>
            <th>Newest indexed</th>
          </tr>
        </thead>
        <tbody>
          {props.sources.map((source) => (
            <tr key={source.sourceId}>
              <td>
                <Link className="table-link" to={`/sources/${encodeURIComponent(source.sourceId)}`}>
                  {source.displayName}
                </Link>
                <span className="subtle-line">{source.sourceId}</span>
              </td>
              <td><StatusBadge tone={source.enabled ? "good" : "muted"} label={source.enabled ? "enabled" : "disabled"} /></td>
              <td>{formatCount(source.pageCount)}</td>
              <td>{formatCount(source.chunkCount)}</td>
              <td>{formatCoverage(source.embeddingCoverage)}</td>
              <td>{formatCount(source.stalePages)}</td>
              <td>{formatCount(source.tombstonedPages)}</td>
              <td>{formatDateTime(source.newestIndexedPage)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SourceSummary(props: { readonly source: AdminSourceHealth }) {
  return (
    <section className="detail-panel">
      <div className="detail-heading">
        <div>
          <h3>{props.source.displayName}</h3>
          <span>{props.source.sourceId}</span>
        </div>
        <StatusBadge tone={props.source.enabled ? "good" : "muted"} label={props.source.enabled ? "enabled" : "disabled"} />
      </div>
      <dl className="detail-grid">
        <DetailItem label="Allowed URL patterns" value={props.source.allowedUrlPatterns.join(", ")} />
        <DetailItem label="Default TTL" value={`${formatCount(props.source.defaultTtlSeconds)} seconds`} />
        <DetailItem label="Pages" value={formatCount(props.source.pageCount)} />
        <DetailItem label="Chunks" value={formatCount(props.source.chunkCount)} />
        <DetailItem label="Embeddings" value={formatCount(props.source.embeddingCount)} />
        <DetailItem label="Embedding coverage" value={formatCoverage(props.source.embeddingCoverage)} />
        <DetailItem label="Oldest fetched" value={formatDateTime(props.source.oldestFetchedPage)} />
        <DetailItem label="Newest indexed" value={formatDateTime(props.source.newestIndexedPage)} />
      </dl>
    </section>
  );
}

interface AdminActionControl<TInput = void> {
  readonly isPending: boolean;
  readonly message: string | null;
  readonly error: string | null;
  readonly run: (input: TInput) => void;
}

export function SourceActionsPanel(props: {
  readonly source: AdminSourceHealth;
  readonly userRole: AdminRole;
  readonly refreshAction: AdminActionControl;
  readonly tombstoneAction: AdminActionControl<AdminConfirmedSourceActionRequest>;
  readonly purgeReindexAction: AdminActionControl<Pick<AdminConfirmedSourceActionRequest, "confirmation">>;
}) {
  const [tombstoneConfirmation, setTombstoneConfirmation] = useState("");
  const [tombstoneReason, setTombstoneReason] = useState("");
  const [purgeConfirmation, setPurgeConfirmation] = useState("");

  if (props.userRole !== "admin") {
    return null;
  }

  const tombstoneReady = isSourceActionConfirmationValid(props.source.sourceId, tombstoneConfirmation);
  const purgeReady = isSourceActionConfirmationValid(props.source.sourceId, purgeConfirmation);

  return (
    <section className="action-panel" aria-label="Source actions">
      <div className="action-panel-heading">
        <h3>Admin actions</h3>
        <StatusBadge tone="warn" label="admin only" />
      </div>
      <div className="action-grid">
        <div className="action-card">
          <div>
            <h4>Refresh source</h4>
            <span>Queue a manual source index job.</span>
          </div>
          <button className="button button-secondary" type="button" disabled={props.refreshAction.isPending} onClick={() => props.refreshAction.run()}>
            <RefreshCw size={15} aria-hidden="true" />
            {props.refreshAction.isPending ? "Queueing" : "Refresh source"}
          </button>
          <ActionFeedback message={props.refreshAction.message} error={props.refreshAction.error} />
        </div>
        <div className="action-card">
          <div>
            <h4>Tombstone source</h4>
            <span>Mark current pages as disabled without physical delete.</span>
          </div>
          <label>
            <span>Reason</span>
            <input value={tombstoneReason} onChange={(event) => setTombstoneReason(event.target.value)} placeholder="admin tombstone" />
          </label>
          <label>
            <span>Type source ID</span>
            <input value={tombstoneConfirmation} onChange={(event) => setTombstoneConfirmation(event.target.value)} placeholder={props.source.sourceId} />
          </label>
          <button
            className="button button-danger"
            type="button"
            disabled={!tombstoneReady || props.tombstoneAction.isPending}
            onClick={() => props.tombstoneAction.run({ confirmation: tombstoneConfirmation.trim(), ...(tombstoneReason.trim().length === 0 ? {} : { reason: tombstoneReason.trim() }) })}
          >
            <ArchiveX size={15} aria-hidden="true" />
            {props.tombstoneAction.isPending ? "Tombstoning" : "Tombstone source"}
          </button>
          <ActionFeedback message={props.tombstoneAction.message} error={props.tombstoneAction.error} />
        </div>
        <div className="action-card">
          <div>
            <h4>Purge and reindex</h4>
            <span>Tombstone current pages and queue a replacement index run.</span>
          </div>
          <label>
            <span>Type source ID</span>
            <input value={purgeConfirmation} onChange={(event) => setPurgeConfirmation(event.target.value)} placeholder={props.source.sourceId} />
          </label>
          <button
            className="button button-danger"
            type="button"
            disabled={!purgeReady || props.purgeReindexAction.isPending}
            onClick={() => props.purgeReindexAction.run({ confirmation: purgeConfirmation.trim() })}
          >
            <Trash2 size={15} aria-hidden="true" />
            {props.purgeReindexAction.isPending ? "Queueing" : "Purge and reindex"}
          </button>
          <ActionFeedback message={props.purgeReindexAction.message} error={props.purgeReindexAction.error} />
        </div>
      </div>
    </section>
  );
}

function PagesTable(props: { readonly sourceId: string; readonly pages: readonly AdminPageListItem[] }) {
  if (props.pages.length === 0) {
    return <InlineState tone="neutral" title="No pages match these filters" />;
  }

  return (
    <div className="table-frame">
      <table>
        <thead>
          <tr>
            <th>Page</th>
            <th>Freshness</th>
            <th>HTTP</th>
            <th>Chunks</th>
            <th>Embeddings</th>
            <th>Fetched</th>
            <th>Indexed</th>
          </tr>
        </thead>
        <tbody>
          {props.pages.map((page) => (
            <tr key={page.id}>
              <td>
                <Link className="table-link" to={`/sources/${encodeURIComponent(props.sourceId)}/pages/${page.id}`}>
                  {page.title.length === 0 ? page.url : page.title}
                </Link>
                <span className="subtle-line">{page.canonicalUrl}</span>
              </td>
              <td><FreshnessBadge freshness={page.freshness} /></td>
              <td>{page.httpStatus}</td>
              <td>{formatCount(page.chunkCount)}</td>
              <td>{formatCount(page.embeddingCount)}</td>
              <td>{formatDateTime(page.fetchedAt)}</td>
              <td>{formatDateTime(page.indexedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PageDetailView(props: { readonly page: AdminPageDetail }) {
  return (
    <section className="detail-panel">
      <div className="detail-heading">
        <div>
          <h3>{props.page.title.length === 0 ? props.page.url : props.page.title}</h3>
          <span>{props.page.canonicalUrl}</span>
        </div>
        <FreshnessBadge freshness={props.page.freshness} />
      </div>
      <dl className="detail-grid">
        <DetailItem label="Source" value={props.page.sourceId} />
        <DetailItem label="HTTP status" value={String(props.page.httpStatus)} />
        <DetailItem label="Content hash" value={props.page.contentHash} />
        <DetailItem label="Fetched" value={formatDateTime(props.page.fetchedAt)} />
        <DetailItem label="Indexed" value={formatDateTime(props.page.indexedAt)} />
        <DetailItem label="Expires" value={formatDateTime(props.page.expiresAt)} />
        <DetailItem label="Tombstoned" value={formatDateTime(props.page.tombstonedAt)} />
        <DetailItem label="Tombstone reason" value={props.page.tombstoneReason ?? "none"} />
      </dl>
      <SectionHeader title="Chunks" />
      <div className="table-frame">
        <table>
          <thead>
            <tr>
              <th>Chunk</th>
              <th>Heading path</th>
              <th>Tokens</th>
              <th>Embeddings</th>
              <th>Hash</th>
            </tr>
          </thead>
          <tbody>
            {props.page.chunks.map((chunk) => (
              <tr key={chunk.id}>
                <td>
                  <Link className="table-link" to={`/sources/${encodeURIComponent(props.page.sourceId)}/chunks/${chunk.id}`}>
                    #{chunk.chunkIndex}
                  </Link>
                </td>
                <td>{formatHeadingPath(chunk.headingPath)}</td>
                <td>{formatCount(chunk.tokenEstimate)}</td>
                <td>{formatCount(chunk.embeddingCount)}</td>
                <td><code>{chunk.contentHash}</code></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <SectionHeader title="Content" />
      <pre className="content-block">{props.page.content}</pre>
    </section>
  );
}

export function ChunkDetailView(props: { readonly chunk: AdminChunkDetail }) {
  return (
    <section className="detail-panel">
      <div className="detail-heading">
        <div>
          <h3>{props.chunk.title.length === 0 ? props.chunk.pageTitle : props.chunk.title}</h3>
          <span>{formatHeadingPath(props.chunk.headingPath)}</span>
        </div>
        <StatusBadge tone={props.chunk.hasEmbedding ? "good" : "warn"} label={props.chunk.hasEmbedding ? "embedded" : "missing embedding"} />
      </div>
      <dl className="detail-grid">
        <DetailItem label="Source" value={props.chunk.sourceId} />
        <DetailItem label="Page" value={props.chunk.pageTitle} />
        <DetailItem label="Chunk index" value={String(props.chunk.chunkIndex)} />
        <DetailItem label="Token estimate" value={formatCount(props.chunk.tokenEstimate)} />
        <DetailItem label="Embeddings" value={formatCount(props.chunk.embeddingCount)} />
        <DetailItem label="Content hash" value={props.chunk.contentHash} />
      </dl>
      <div className="detail-actions">
        {props.chunk.previousChunkId === null ? null : (
          <Link className="button button-secondary" to={`/sources/${encodeURIComponent(props.chunk.sourceId)}/chunks/${props.chunk.previousChunkId}`}>
            Previous chunk
          </Link>
        )}
        {props.chunk.nextChunkId === null ? null : (
          <Link className="button button-secondary" to={`/sources/${encodeURIComponent(props.chunk.sourceId)}/chunks/${props.chunk.nextChunkId}`}>
            Next chunk
          </Link>
        )}
      </div>
      <pre className="content-block">{props.chunk.content}</pre>
    </section>
  );
}

function JobsTable(props: { readonly jobs: readonly AdminJobSummary[]; readonly compact?: boolean }) {
  if (props.jobs.length === 0) {
    return <InlineState tone="neutral" title="No jobs match these filters" />;
  }

  return (
    <div className="table-frame">
      <table>
        <thead>
          <tr>
            <th>Job</th>
            <th>Status</th>
            <th>Type</th>
            <th>Reason</th>
            {props.compact ? null : <th>Priority</th>}
            <th>Attempts</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {props.jobs.map((job) => (
            <tr key={job.id}>
              <td>
                <Link className="table-link" to={`/jobs/${job.id}`}>
                  #{job.id}
                </Link>
                <span className="subtle-line">{job.url ?? job.sourceId}</span>
              </td>
              <td><JobStatusBadge status={job.status} /></td>
              <td>{formatEnum(job.jobType)}</td>
              <td>{formatEnum(job.reason)}</td>
              {props.compact ? null : <td>{job.priority}</td>}
              <td>{formatCount(job.attemptCount)}</td>
              <td>{formatDateTime(job.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function JobDetailView(props: { readonly job: AdminJobSummary }) {
  const sanitizedError = sanitizeJobError(props.job.lastError);

  return (
    <section className="detail-panel">
      <div className="detail-heading">
        <div>
          <h3>Job #{props.job.id}</h3>
          <span>{props.job.url ?? props.job.sourceId}</span>
        </div>
        <JobStatusBadge status={props.job.status} />
      </div>
      <dl className="detail-grid">
        <DetailItem label="Source" value={props.job.sourceId} />
        <DetailItem label="Type" value={formatEnum(props.job.jobType)} />
        <DetailItem label="Reason" value={formatEnum(props.job.reason)} />
        <DetailItem label="Priority" value={String(props.job.priority)} />
        <DetailItem label="Attempts" value={formatCount(props.job.attemptCount)} />
        <DetailItem label="Run after" value={formatDateTime(props.job.runAfter)} />
        <DetailItem label="Started" value={formatDateTime(props.job.startedAt)} />
        <DetailItem label="Finished" value={formatDateTime(props.job.finishedAt)} />
        <DetailItem label="Created" value={formatDateTime(props.job.createdAt)} />
        <DetailItem label="Updated" value={formatDateTime(props.job.updatedAt)} />
      </dl>
      <SectionHeader title="Last error" />
      <pre className="error-block">{sanitizedError ?? "No error recorded."}</pre>
    </section>
  );
}

export function JobActionsPanel(props: {
  readonly job: AdminJobSummary;
  readonly userRole: AdminRole;
  readonly retryAction: AdminActionControl;
}) {
  if (props.userRole !== "admin" || props.job.status !== "failed") {
    return null;
  }

  return (
    <section className="action-panel" aria-label="Job actions">
      <div className="action-panel-heading">
        <h3>Admin actions</h3>
        <StatusBadge tone="warn" label="admin only" />
      </div>
      <div className="action-card action-card-inline">
        <div>
          <h4>Retry failed job</h4>
          <span>Queue a new manual job with the same target.</span>
        </div>
        <button className="button button-secondary" type="button" disabled={props.retryAction.isPending} onClick={() => props.retryAction.run()}>
          <RotateCcw size={15} aria-hidden="true" />
          {props.retryAction.isPending ? "Retrying" : "Retry failed job"}
        </button>
        <ActionFeedback message={props.retryAction.message} error={props.retryAction.error} />
      </div>
    </section>
  );
}

function PageFiltersForm(props: { readonly filters: AdminPageListOptions; readonly onSubmit: (next: URLSearchParams) => void }) {
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const next = new URLSearchParams();
    const q = String(data.get("q") ?? "").trim();
    const freshness = String(data.get("freshness") ?? "");
    const hasEmbedding = String(data.get("hasEmbedding") ?? "");

    if (q.length > 0) {
      next.set("q", q);
    }

    if (freshness.length > 0) {
      next.set("freshness", freshness);
    }

    if (hasEmbedding.length > 0) {
      next.set("hasEmbedding", hasEmbedding);
    }

    props.onSubmit(next);
  }

  return (
    <form className="filter-bar" onSubmit={submit}>
      <label>
        <span>Query</span>
        <input name="q" defaultValue={props.filters.q ?? ""} placeholder="Title or URL" />
      </label>
      <label>
        <span>Freshness</span>
        <select name="freshness" defaultValue={props.filters.freshness ?? ""}>
          <option value="">All</option>
          <option value="fresh">Fresh</option>
          <option value="stale">Stale</option>
          <option value="expired">Expired</option>
          <option value="tombstoned">Tombstoned</option>
        </select>
      </label>
      <label>
        <span>Embedding</span>
        <select name="hasEmbedding" defaultValue={props.filters.hasEmbedding === undefined ? "" : String(props.filters.hasEmbedding)}>
          <option value="">All</option>
          <option value="true">Present</option>
          <option value="false">Missing</option>
        </select>
      </label>
      <button className="button button-secondary" type="submit">Apply</button>
    </form>
  );
}

function JobsFiltersForm(props: { readonly filters: AdminJobListOptions; readonly onSubmit: (next: URLSearchParams) => void }) {
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const next = new URLSearchParams();
    const failedOnly = data.get("failedOnly") === "true";
    const sourceId = String(data.get("sourceId") ?? "").trim();
    const status = failedOnly ? "failed" : String(data.get("status") ?? "");
    const jobType = String(data.get("jobType") ?? "");
    const reason = String(data.get("reason") ?? "");
    const urlContains = String(data.get("urlContains") ?? "").trim();

    if (sourceId.length > 0) {
      next.set("sourceId", sourceId);
    }

    if (status.length > 0) {
      next.set("status", status);
    }

    if (failedOnly) {
      next.set("failedOnly", "true");
    }

    if (jobType.length > 0) {
      next.set("jobType", jobType);
    }

    if (reason.length > 0) {
      next.set("reason", reason);
    }

    if (urlContains.length > 0) {
      next.set("urlContains", urlContains);
    }

    props.onSubmit(next);
  }

  return (
    <form className="filter-bar" onSubmit={submit}>
      <label>
        <span>Source</span>
        <input name="sourceId" defaultValue={props.filters.sourceId ?? ""} placeholder="source ID" />
      </label>
      <label>
        <span>Status</span>
        <select name="status" defaultValue={props.filters.status ?? ""}>
          <option value="">All</option>
          <option value="queued">Queued</option>
          <option value="running">Running</option>
          <option value="succeeded">Succeeded</option>
          <option value="failed">Failed</option>
          <option value="deduplicated">Deduplicated</option>
        </select>
      </label>
      <label>
        <span>Type</span>
        <select name="jobType" defaultValue={props.filters.jobType ?? ""}>
          <option value="">All</option>
          <option value="source_index">Source index</option>
          <option value="page">Page</option>
          <option value="embedding">Embedding</option>
          <option value="tombstone_check">Tombstone check</option>
        </select>
      </label>
      <label>
        <span>Reason</span>
        <select name="reason" defaultValue={props.filters.reason ?? ""}>
          <option value="">All</option>
          <option value="scheduled">Scheduled</option>
          <option value="missing_content">Missing content</option>
          <option value="stale_content">Stale content</option>
          <option value="low_confidence">Low confidence</option>
          <option value="manual">Manual</option>
        </select>
      </label>
      <label>
        <span>URL</span>
        <input name="urlContains" defaultValue={props.filters.urlContains ?? ""} placeholder="contains" />
      </label>
      <label className="checkbox-field">
        <input name="failedOnly" value="true" type="checkbox" defaultChecked={props.filters.status === "failed"} />
        <span>Failed only</span>
      </label>
      <button className="button button-secondary" type="submit">Apply</button>
    </form>
  );
}

export function pageFiltersFromSearchParams(sourceId: string, params: URLSearchParams): AdminPageListOptions {
  const q = params.get("q") ?? undefined;
  const freshness = parseFreshness(params.get("freshness"));
  const hasEmbedding = parseOptionalBoolean(params.get("hasEmbedding"));
  const cursor = parseOptionalNumber(params.get("cursor"));

  return {
    sourceId,
    limit: pageLimit,
    ...(q === undefined || q.length === 0 ? {} : { q }),
    ...(freshness === undefined ? {} : { freshness }),
    ...(hasEmbedding === undefined ? {} : { hasEmbedding }),
    ...(cursor === undefined ? {} : { cursor })
  };
}

export function jobFiltersFromSearchParams(params: URLSearchParams): AdminJobListOptions {
  const failedOnly = params.get("failedOnly") === "true";
  const status = failedOnly ? "failed" : parseJobStatus(params.get("status"));
  const jobType = parseJobType(params.get("jobType"));
  const reason = parseJobReason(params.get("reason"));
  const cursor = parseOptionalNumber(params.get("cursor"));
  const sourceId = params.get("sourceId") ?? undefined;
  const urlContains = params.get("urlContains") ?? undefined;

  return {
    limit: jobLimit,
    ...(sourceId === undefined || sourceId.length === 0 ? {} : { sourceId }),
    ...(status === undefined ? {} : { status }),
    ...(jobType === undefined ? {} : { jobType }),
    ...(reason === undefined ? {} : { reason }),
    ...(urlContains === undefined || urlContains.length === 0 ? {} : { urlContains }),
    ...(cursor === undefined ? {} : { cursor })
  };
}

export function sanitizeJobError(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\b(sk|pk|rk)-[A-Za-z0-9_-]{8,}\b/g, "$1-[redacted]")
    .replace(/\b([A-Za-z0-9_.-]*(?:token|secret|password|api[_-]?key)[A-Za-z0-9_.-]*)(=|:)\s*([^\s,;]+)/gi, "$1$2 [redacted]");
}

export function isSourceActionConfirmationValid(sourceId: string, confirmation: string): boolean {
  return confirmation.trim() === sourceId;
}

export function invalidateAdminActionQueries(queryClient: QueryClient, input: { readonly sourceId?: string; readonly jobId?: number }): void {
  void queryClient.invalidateQueries({ queryKey: ["admin", "overview"] });
  void queryClient.invalidateQueries({ queryKey: ["admin", "kpis"] });
  void queryClient.invalidateQueries({ queryKey: ["admin", "sources"] });
  void queryClient.invalidateQueries({ queryKey: ["admin", "jobs"] });
  void queryClient.invalidateQueries({ queryKey: ["admin", "audit"] });

  if (input.sourceId !== undefined) {
    void queryClient.invalidateQueries({ queryKey: ["admin", "sources", input.sourceId] });
  }

  if (input.jobId !== undefined) {
    void queryClient.invalidateQueries({ queryKey: ["admin", "jobs", input.jobId] });
  }
}

function ActionFeedback(props: { readonly message: string | null; readonly error: string | null }) {
  if (props.error !== null) {
    return <span className="action-feedback action-feedback-error">{props.error}</span>;
  }

  if (props.message !== null) {
    return <span className="action-feedback">{props.message}</span>;
  }

  return null;
}

function actionMessage(action: AdminActionResult | undefined): string | null {
  return action?.message ?? null;
}

function actionErrorMessage(error: Error | null): string | null {
  return error === null ? null : error.message;
}

function PageFrame(props: { readonly title: string; readonly children: ReactNode }) {
  return (
    <div className="page-frame">
      <header className="page-header">
        <div>
          <h2>{props.title}</h2>
        </div>
      </header>
      {props.children}
    </div>
  );
}

function SectionHeader(props: { readonly title: string }) {
  return <h3 className="section-title">{props.title}</h3>;
}

function InlineState(props: { readonly tone: "neutral" | "danger"; readonly title: string }) {
  return <div className={`inline-state inline-state-${props.tone}`}><strong>{props.title}</strong></div>;
}

function DetailItem(props: { readonly label: string; readonly value: string }) {
  return (
    <div>
      <dt>{props.label}</dt>
      <dd>{props.value}</dd>
    </div>
  );
}

function StatusBadge(props: { readonly tone: "good" | "muted" | "warn" | "danger"; readonly label: string }) {
  return <span className={`status-badge status-${props.tone}`}>{props.label}</span>;
}

function FreshnessBadge(props: { readonly freshness: AdminPageListItem["freshness"] }) {
  const tone = props.freshness === "fresh" ? "good" : props.freshness === "tombstoned" ? "danger" : "warn";
  return <StatusBadge tone={tone} label={props.freshness} />;
}

function JobStatusBadge(props: { readonly status: AdminJobSummary["status"] }) {
  const tone = props.status === "succeeded" ? "good" : props.status === "failed" ? "danger" : props.status === "running" ? "warn" : "muted";
  return <StatusBadge tone={tone} label={props.status} />;
}

function PaginationLink(props: { readonly nextCursor: number | null; readonly searchParams: URLSearchParams }) {
  if (props.nextCursor === null) {
    return null;
  }

  const next = new URLSearchParams(props.searchParams);
  next.set("cursor", String(props.nextCursor));

  return (
    <div className="pagination-row">
      <Link className="button button-secondary" to={`?${next.toString()}`}>
        Next page
      </Link>
    </div>
  );
}

function parseRouteId(value: string | undefined): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function parseOptionalNumber(value: string | null): number | undefined {
  if (value === null || value.length === 0) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function parseOptionalBoolean(value: string | null): boolean | undefined {
  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return undefined;
}

function parseFreshness(value: string | null): AdminPageListItem["freshness"] | undefined {
  return value === "fresh" || value === "stale" || value === "expired" || value === "tombstoned" ? value : undefined;
}

function parseJobStatus(value: string | null): AdminJobSummary["status"] | undefined {
  return value === "queued" || value === "running" || value === "succeeded" || value === "failed" || value === "deduplicated" ? value : undefined;
}

function parseJobType(value: string | null): AdminJobSummary["jobType"] | undefined {
  return value === "source_index" || value === "page" || value === "embedding" || value === "tombstone_check" ? value : undefined;
}

function parseJobReason(value: string | null): AdminJobSummary["reason"] | undefined {
  return value === "scheduled" || value === "missing_content" || value === "stale_content" || value === "low_confidence" || value === "manual" ? value : undefined;
}

function formatHeadingPath(path: readonly string[]): string {
  return path.length === 0 ? "root" : path.join(" / ");
}

function formatEnum(value: string): string {
  return value.replaceAll("_", " ");
}

function formatCoverage(value: number | null): string {
  return value === null ? "Unavailable" : `${Math.round(value * 1000) / 10}%`;
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatDateTime(value: string | null): string {
  return value === null ? "n/a" : value.replace("T", " ").slice(0, 16);
}
