import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import type { AdminJobSummary, AdminKpiWindow, AdminOverviewKpis, AdminSourceHealth } from "@bun-dev-intel/admin-contracts";
import { useAdminApi } from "./session";

export const adminKpiWindowOptions: readonly AdminKpiWindow[] = ["1h", "24h", "7d", "30d"];

export const adminOverviewQueryKey = (selectedWindow: AdminKpiWindow) => ["admin", "overview", selectedWindow] as const;
export const adminSourcesQueryKey = ["admin", "sources"] as const;
export const adminJobsQueryKey = (selectedWindow: AdminKpiWindow) => ["admin", "jobs", selectedWindow] as const;

interface KpiCardModel {
  readonly label: string;
  readonly value: string;
  readonly detail?: string;
  readonly tone?: "default" | "warn" | "danger" | "unavailable";
}

interface SearchTrendDatum {
  readonly label: string;
  readonly searches: number;
  readonly zeroResults: number;
}

interface JobStatusTimelineDatum {
  readonly label: string;
  readonly queued: number;
  readonly running: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly deduplicated: number;
}

interface EmbeddingCoverageDatum {
  readonly label: string;
  readonly coverage: number;
  readonly chunks: number;
}

interface FailedJobsByTypeDatum {
  readonly label: string;
  readonly failed: number;
}

interface ChartSummaryItem {
  readonly label: string;
  readonly value: string;
}

export function OverviewPage() {
  const [selectedWindow, setSelectedWindow] = useState<AdminKpiWindow>("24h");
  const dashboard = useOverviewDashboard(selectedWindow);

  return (
    <div className="page-frame">
      <header className="page-header">
        <div>
          <h2>Overview</h2>
          {dashboard.overview === undefined ? null : (
            <p className="page-subtitle">
              {formatWindowLabel(dashboard.overview.window)} window, generated {formatIsoMinute(dashboard.overview.generatedAt)}
            </p>
          )}
        </div>
      </header>
      <div className="toolbar">
        <KpiWindowSelector selectedWindow={selectedWindow} onWindowChange={setSelectedWindow} />
      </div>
      {dashboard.isLoading ? <OverviewLoadingState /> : null}
      {dashboard.isError ? <InlineState tone="danger" title="Overview data failed to load" /> : null}
      {!dashboard.isLoading && !dashboard.isError && dashboard.overview !== undefined ? (
        <OverviewDashboardView overview={dashboard.overview} sources={dashboard.sources} jobs={dashboard.jobs} />
      ) : null}
    </div>
  );
}

function useOverviewDashboard(selectedWindow: AdminKpiWindow) {
  const api = useAdminApi();
  const overviewQuery = useQuery({
    queryKey: adminOverviewQueryKey(selectedWindow),
    queryFn: () => api.getOverview(selectedWindow)
  });
  const sourcesQuery = useQuery({
    queryKey: adminSourcesQueryKey,
    queryFn: () => api.listSources()
  });
  const jobsQuery = useQuery({
    queryKey: adminJobsQueryKey(selectedWindow),
    queryFn: () => api.listJobs({ window: selectedWindow, limit: 100 })
  });

  return {
    overview: overviewQuery.data,
    sources: sourcesQuery.data ?? [],
    jobs: jobsQuery.data?.jobs ?? [],
    isLoading: overviewQuery.isLoading || sourcesQuery.isLoading || jobsQuery.isLoading,
    isError: overviewQuery.isError || sourcesQuery.isError || jobsQuery.isError
  };
}

export function KpiWindowSelector(props: {
  readonly selectedWindow: AdminKpiWindow;
  readonly onWindowChange: (selectedWindow: AdminKpiWindow) => void;
}) {
  return (
    <div className="segmented-control" aria-label="KPI window">
      {adminKpiWindowOptions.map((option) => (
        <button
          key={option}
          type="button"
          className={option === props.selectedWindow ? "is-selected" : ""}
          aria-pressed={option === props.selectedWindow}
          onClick={() => props.onWindowChange(option)}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

export function OverviewDashboardView(props: {
  readonly overview: AdminOverviewKpis;
  readonly sources: readonly AdminSourceHealth[];
  readonly jobs: readonly AdminJobSummary[];
}) {
  const searchTrend = useMemo(() => buildSearchTrendData(props.overview), [props.overview]);
  const jobTimeline = useMemo(() => buildJobStatusTimelineData(props.jobs, props.overview), [props.jobs, props.overview]);
  const embeddingCoverage = useMemo(() => buildEmbeddingCoverageData(props.sources), [props.sources]);
  const failedByType = useMemo(() => buildFailedJobsByTypeData(props.jobs), [props.jobs]);
  const kpis = useMemo(() => buildOverviewKpiCards(props.overview), [props.overview]);

  return (
    <>
      {isOverviewEmpty(props.overview, props.sources, props.jobs) ? (
        <InlineState tone="neutral" title="No indexed data yet" detail="Sources, pages, chunks, jobs, and retrieval events are all empty for this window." />
      ) : null}
      <section className="metric-grid overview-metrics" aria-label="Overview KPIs">
        {kpis.map((metric) => (
          <MetricCell key={metric.label} metric={metric} />
        ))}
      </section>
      <section className="chart-grid" aria-label="Overview charts">
        <SearchTrendChart data={searchTrend} />
        <JobStatusTimelineChart data={jobTimeline} />
        <EmbeddingCoverageChart data={embeddingCoverage} />
        <FailedJobsByTypeChart data={failedByType} />
      </section>
    </>
  );
}

export function buildOverviewKpiCards(overview: AdminOverviewKpis): readonly KpiCardModel[] {
  return [
    {
      label: "Sources",
      value: `${formatCount(overview.enabledSources)} / ${formatCount(overview.totalSources)}`,
      detail: "enabled"
    },
    { label: "Pages", value: formatCount(overview.totalPages) },
    { label: "Chunks", value: formatCount(overview.totalChunks) },
    {
      label: "Embeddings",
      value: formatCount(overview.totalEmbeddings),
      detail: `${formatCount(overview.embeddedChunkCount)} chunks embedded`
    },
    {
      label: "Embedding coverage",
      value: formatNullablePercent(overview.embeddingCoverage),
      tone: overview.embeddingCoverage === null ? "unavailable" : overview.embeddingCoverage < 0.9 ? "warn" : "default"
    },
    { label: "Stale pages", value: formatCount(overview.stalePages), tone: overview.stalePages > 0 ? "warn" : "default" },
    {
      label: "Tombstoned pages",
      value: formatCount(overview.tombstonedPages),
      tone: overview.tombstonedPages > 0 ? "warn" : "default"
    },
    { label: "Queued jobs", value: formatCount(overview.queuedJobs), tone: overview.queuedJobs > 0 ? "warn" : "default" },
    { label: "Running jobs", value: formatCount(overview.runningJobs) },
    { label: "Failed jobs", value: formatCount(overview.failedJobs), tone: overview.failedJobs > 0 ? "danger" : "default" },
    { label: "Searches", value: formatCount(overview.searches) },
    {
      label: "Zero-result rate",
      value: overview.zeroResultRate === null ? "No searches" : formatPercent(overview.zeroResultRate),
      tone: overview.zeroResultRate !== null && overview.zeroResultRate > 0.2 ? "warn" : "default"
    },
    {
      label: "Low-confidence rate",
      value: overview.lowConfidenceRate === null ? "No searches" : formatPercent(overview.lowConfidenceRate),
      tone: overview.lowConfidenceRate !== null && overview.lowConfidenceRate > 0.2 ? "warn" : "default"
    },
    {
      label: "Stale-result rate",
      value: "Unavailable",
      detail: overview.staleResultRate.reason,
      tone: "unavailable"
    },
    { label: "Refresh queued", value: formatCount(overview.refreshQueuedCount), tone: overview.refreshQueuedCount > 0 ? "warn" : "default" }
  ];
}

export function buildSearchTrendData(overview: AdminOverviewKpis): SearchTrendDatum[] {
  if (overview.searches === 0 && overview.zeroResultCount === 0) {
    return [];
  }

  return [
    { label: "Start", searches: 0, zeroResults: 0 },
    {
      label: formatWindowLabel(overview.window),
      searches: overview.searches,
      zeroResults: overview.zeroResultCount
    }
  ];
}

export function buildJobStatusTimelineData(jobs: readonly AdminJobSummary[], overview: AdminOverviewKpis): JobStatusTimelineDatum[] {
  if (jobs.length === 0) {
    return [];
  }

  const startMs = Date.parse(overview.windowStartedAt);
  const endMs = Date.parse(overview.generatedAt);

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return buildSingleJobStatusBucket(jobs, formatWindowLabel(overview.window));
  }

  const bucketCount = overview.window === "7d" ? 7 : 6;
  const spanMs = endMs - startMs;
  const bucketMs = spanMs / bucketCount;
  const buckets = Array.from({ length: bucketCount }, (_, index): JobStatusTimelineDatum => {
    const bucketStart = new Date(startMs + bucketMs * index);
    return {
      label: formatBucketLabel(bucketStart, overview.window),
      queued: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
      deduplicated: 0
    };
  });

  for (const job of jobs) {
    const timestamp = Date.parse(job.finishedAt ?? job.startedAt ?? job.updatedAt ?? job.createdAt);

    if (!Number.isFinite(timestamp) || timestamp < startMs || timestamp > endMs) {
      continue;
    }

    const bucketIndex = Math.min(bucketCount - 1, Math.max(0, Math.floor((timestamp - startMs) / bucketMs)));
    buckets[bucketIndex] = incrementJobStatusBucket(buckets[bucketIndex] ?? buckets[0]!, job.status);
  }

  return buckets.some((bucket) => getJobBucketTotal(bucket) > 0) ? buckets : [];
}

export function buildEmbeddingCoverageData(sources: readonly AdminSourceHealth[]): EmbeddingCoverageDatum[] {
  return sources
    .filter((source) => source.embeddingCoverage !== null)
    .map((source) => ({
      label: source.displayName,
      coverage: percentValue(source.embeddingCoverage ?? 0),
      chunks: source.chunkCount
    }));
}

export function buildFailedJobsByTypeData(jobs: readonly AdminJobSummary[]): FailedJobsByTypeDatum[] {
  const counts: Record<AdminJobSummary["jobType"], number> = {
    source_index: 0,
    page: 0,
    embedding: 0,
    tombstone_check: 0
  };

  for (const job of jobs) {
    if (job.status === "failed") {
      counts[job.jobType] += 1;
    }
  }

  return Object.entries(counts)
    .filter(([, failed]) => failed > 0)
    .map(([jobType, failed]) => ({
      label: jobTypeLabels[jobType as AdminJobSummary["jobType"]],
      failed
    }));
}

export function EmbeddingCoverageChart(props: { readonly data: EmbeddingCoverageDatum[] }) {
  return (
    <ChartPanel title="Embedding coverage by source" emptyLabel="No embedding coverage data is available." summary={props.data.map((item) => ({
      label: item.label,
      value: `${formatPercent(item.coverage / 100)} of ${formatCount(item.chunks)} chunks`
    }))}>
      <BarChart width={520} height={220} data={props.data} margin={{ top: 12, right: 16, bottom: 18, left: 0 }}>
        <CartesianGrid stroke="#e4e8e1" vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} />
        <YAxis domain={[0, 100]} tickFormatter={(value) => `${value}%`} tickLine={false} axisLine={false} width={42} />
        <Tooltip formatter={(value) => [`${value}%`, "Coverage"]} />
        <Bar dataKey="coverage" fill="#2f6f4f" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ChartPanel>
  );
}

function SearchTrendChart(props: { readonly data: SearchTrendDatum[] }) {
  return (
    <ChartPanel title="Searches over time" emptyLabel="No searches recorded in this window." summary={props.data.map((item) => ({
      label: item.label,
      value: `${formatCount(item.searches)} searches`
    }))}>
      <LineChart width={520} height={220} data={props.data} margin={{ top: 12, right: 18, bottom: 18, left: 0 }}>
        <CartesianGrid stroke="#e4e8e1" vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={38} />
        <Tooltip />
        <Line type="monotone" dataKey="searches" stroke="#2f6f4f" strokeWidth={2} dot={{ r: 3 }} name="Searches" />
        <Line type="monotone" dataKey="zeroResults" stroke="#a13936" strokeWidth={2} dot={{ r: 3 }} name="Zero results" />
      </LineChart>
    </ChartPanel>
  );
}

function JobStatusTimelineChart(props: { readonly data: JobStatusTimelineDatum[] }) {
  return (
    <ChartPanel title="Job statuses over time" emptyLabel="No refresh jobs recorded in this window." summary={props.data.map((item) => ({
      label: item.label,
      value: `${formatCount(getJobBucketTotal(item))} jobs`
    }))}>
      <BarChart width={520} height={220} data={props.data} margin={{ top: 12, right: 16, bottom: 18, left: 0 }}>
        <CartesianGrid stroke="#e4e8e1" vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={38} />
        <Tooltip />
        <Bar dataKey="queued" stackId="jobs" fill="#496a89" radius={[4, 4, 0, 0]} name="Queued" />
        <Bar dataKey="running" stackId="jobs" fill="#8a6a25" name="Running" />
        <Bar dataKey="succeeded" stackId="jobs" fill="#2f6f4f" name="Succeeded" />
        <Bar dataKey="failed" stackId="jobs" fill="#a13936" name="Failed" />
        <Bar dataKey="deduplicated" stackId="jobs" fill="#6f5b8a" name="Deduplicated" />
      </BarChart>
    </ChartPanel>
  );
}

function FailedJobsByTypeChart(props: { readonly data: FailedJobsByTypeDatum[] }) {
  return (
    <ChartPanel title="Failed jobs by type" emptyLabel="No failed jobs recorded in this window." summary={props.data.map((item) => ({
      label: item.label,
      value: `${formatCount(item.failed)} failed`
    }))}>
      <BarChart width={520} height={220} data={props.data} margin={{ top: 12, right: 16, bottom: 18, left: 0 }}>
        <CartesianGrid stroke="#e4e8e1" vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={38} />
        <Tooltip />
        <Bar dataKey="failed" fill="#a13936" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ChartPanel>
  );
}

function ChartPanel(props: { readonly title: string; readonly emptyLabel: string; readonly summary: readonly ChartSummaryItem[]; readonly children: ReactNode }) {
  return (
    <div className="chart-panel">
      <div className="chart-header">
        <h3>{props.title}</h3>
      </div>
      {props.summary.length === 0 ? (
        <div className="chart-empty">{props.emptyLabel}</div>
      ) : (
        <>
          <div className="chart-canvas">{props.children}</div>
          <ul className="chart-summary" aria-label={`${props.title} values`}>
            {props.summary.map((item) => (
              <li key={`${item.label}:${item.value}`}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function MetricCell(props: { readonly metric: KpiCardModel }) {
  return (
    <div className={`metric-cell metric-${props.metric.tone ?? "default"}`}>
      <span>{props.metric.label}</span>
      <strong>{props.metric.value}</strong>
      {props.metric.detail === undefined ? null : <small>{props.metric.detail}</small>}
    </div>
  );
}

function OverviewLoadingState() {
  return (
    <section className="metric-grid overview-metrics" aria-label="Loading overview KPIs">
      {Array.from({ length: 8 }, (_, index) => (
        <div className="metric-cell metric-loading" key={index}>
          <span>Loading</span>
          <strong>-</strong>
        </div>
      ))}
    </section>
  );
}

function InlineState(props: { readonly tone: "neutral" | "danger"; readonly title: string; readonly detail?: string }) {
  return (
    <div className={`inline-state inline-state-${props.tone}`}>
      <strong>{props.title}</strong>
      {props.detail === undefined ? null : <span>{props.detail}</span>}
    </div>
  );
}

function buildSingleJobStatusBucket(jobs: readonly AdminJobSummary[], label: string): JobStatusTimelineDatum[] {
  const bucket: JobStatusTimelineDatum = {
    label,
    queued: 0,
    running: 0,
    succeeded: 0,
    failed: 0,
    deduplicated: 0
  };

  const result = jobs.reduce((current, job) => incrementJobStatusBucket(current, job.status), bucket);
  return getJobBucketTotal(result) > 0 ? [result] : [];
}

function incrementJobStatusBucket(bucket: JobStatusTimelineDatum, status: AdminJobSummary["status"]): JobStatusTimelineDatum {
  return {
    ...bucket,
    [status]: bucket[status] + 1
  };
}

function getJobBucketTotal(bucket: JobStatusTimelineDatum): number {
  return bucket.queued + bucket.running + bucket.succeeded + bucket.failed + bucket.deduplicated;
}

function isOverviewEmpty(overview: AdminOverviewKpis, sources: readonly AdminSourceHealth[], jobs: readonly AdminJobSummary[]): boolean {
  return (
    overview.totalSources === 0 &&
    overview.totalPages === 0 &&
    overview.totalChunks === 0 &&
    overview.totalEmbeddings === 0 &&
    overview.queuedJobs === 0 &&
    overview.runningJobs === 0 &&
    overview.failedJobs === 0 &&
    overview.searches === 0 &&
    sources.length === 0 &&
    jobs.length === 0
  );
}

function formatWindowLabel(selectedWindow: AdminKpiWindow): string {
  const labels: Record<AdminKpiWindow, string> = {
    "1h": "1h",
    "24h": "24h",
    "7d": "7d",
    "30d": "30d"
  };

  return labels[selectedWindow];
}

function formatBucketLabel(date: Date, selectedWindow: AdminKpiWindow): string {
  const iso = date.toISOString();
  return selectedWindow === "1h" || selectedWindow === "24h" ? iso.slice(11, 16) : iso.slice(5, 10);
}

function formatIsoMinute(value: string): string {
  return value.replace("T", " ").slice(0, 16);
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatNullablePercent(value: number | null): string {
  return value === null ? "Unavailable" : formatPercent(value);
}

function formatPercent(value: number): string {
  return `${percentValue(value)}%`;
}

function percentValue(value: number): number {
  return Math.round(value * 1000) / 10;
}

const jobTypeLabels: Record<AdminJobSummary["jobType"], string> = {
  source_index: "Source index",
  page: "Page",
  embedding: "Embedding",
  tombstone_check: "Tombstone check"
};
