import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import type {
  AdminSearchRequest,
  AdminSearchResponse,
  AdminSourceHealth
} from "@bun-dev-intel/admin-contracts";
import { useAdminApi } from "./session";

type SearchMode = NonNullable<AdminSearchRequest["mode"]>;

export interface SearchLabFormState {
  readonly query: string;
  readonly sourceId: string;
  readonly mode: SearchMode;
  readonly limit: number;
  readonly forceRefresh: boolean;
}

const defaultSearchForm: SearchLabFormState = {
  query: "",
  sourceId: "",
  mode: "hybrid",
  limit: 10,
  forceRefresh: false
};

export function SearchLabPage() {
  const api = useAdminApi();
  const [form, setForm] = useState<SearchLabFormState>(defaultSearchForm);
  const sourcesQuery = useQuery({
    queryKey: ["admin", "sources", "search-lab"],
    queryFn: () => api.listSources()
  });
  const searchMutation = useMutation({
    mutationFn: (request: AdminSearchRequest) => api.search(request)
  });

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const request = buildSearchRequest(form);

    if (request === null) {
      return;
    }

    searchMutation.mutate(request);
  }

  return (
    <div className="page-frame">
      <header className="page-header">
        <div>
          <h2>Search Lab</h2>
        </div>
      </header>
      <SearchLabForm
        form={form}
        sources={sourcesQuery.data ?? []}
        isSubmitting={searchMutation.isPending}
        onChange={setForm}
        onSubmit={submit}
      />
      {sourcesQuery.isError ? <InlineState tone="danger" title="Sources failed to load" /> : null}
      {searchMutation.isError ? <InlineState tone="danger" title="Search failed" /> : null}
      {searchMutation.data === undefined ? <InlineState tone="neutral" title="Run a search to inspect retrieval diagnostics" /> : null}
      {searchMutation.data === undefined ? null : <SearchResultsView response={searchMutation.data} />}
    </div>
  );
}

export function SearchLabForm(props: {
  readonly form: SearchLabFormState;
  readonly sources: readonly AdminSourceHealth[];
  readonly isSubmitting: boolean;
  readonly onChange: (form: SearchLabFormState) => void;
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form className="search-lab-form" onSubmit={props.onSubmit}>
      <label className="search-query-field">
        <span>Query</span>
        <input
          value={props.form.query}
          placeholder="Search indexed docs"
          onChange={(event) => props.onChange({ ...props.form, query: event.target.value })}
        />
      </label>
      <label>
        <span>Source</span>
        <select value={props.form.sourceId} onChange={(event) => props.onChange({ ...props.form, sourceId: event.target.value })}>
          <option value="">Default</option>
          {props.sources.map((source) => (
            <option key={source.sourceId} value={source.sourceId}>
              {source.displayName}
            </option>
          ))}
        </select>
      </label>
      <div className="mode-control" aria-label="Search mode">
        {(["hybrid", "keyword", "semantic"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            className={props.form.mode === mode ? "is-selected" : ""}
            aria-pressed={props.form.mode === mode}
            onClick={() => props.onChange({ ...props.form, mode })}
          >
            {mode}
          </button>
        ))}
      </div>
      <label>
        <span>Limit</span>
        <input
          type="number"
          min={1}
          max={100}
          value={props.form.limit}
          onChange={(event) => props.onChange({ ...props.form, limit: Number(event.target.value) })}
        />
      </label>
      <label className="checkbox-field">
        <input
          type="checkbox"
          checked={props.form.forceRefresh}
          onChange={(event) => props.onChange({ ...props.form, forceRefresh: event.target.checked })}
        />
        <span>Force refresh</span>
      </label>
      <button className="button button-primary" type="submit" disabled={props.isSubmitting || props.form.query.trim().length === 0}>
        {props.isSubmitting ? "Searching" : "Search"}
      </button>
    </form>
  );
}

export function SearchResultsView(props: { readonly response: AdminSearchResponse }) {
  return (
    <section className="search-results">
      <div className="result-summary">
        <StatusBadge tone={confidenceTone(props.response.confidence)} label={`confidence: ${props.response.confidence}`} />
        <StatusBadge tone={freshnessTone(props.response.freshness)} label={`freshness: ${props.response.freshness}`} />
        <StatusBadge tone={props.response.refreshQueued ? "warn" : "good"} label={props.response.refreshQueued ? "refresh queued" : "no refresh queued"} />
        <span>{props.response.results.length} results</span>
      </div>
      {props.response.confidence === "low" ? <InlineState tone="danger" title="Low-confidence retrieval" /> : null}
      {props.response.refreshQueued ? (
        <InlineState tone="neutral" title={`Refresh queued${props.response.refreshReason === undefined ? "" : `: ${formatEnum(props.response.refreshReason)}`}`} />
      ) : null}
      {props.response.warnings.length === 0 ? null : <WarningsList warnings={props.response.warnings} />}
      {props.response.results.length === 0 ? (
        <InlineState tone="neutral" title="No results for this query" />
      ) : (
        <ol className="result-list">
          {props.response.results.map((result) => (
            <li className="result-item" key={result.chunkId}>
              <div className="result-heading">
                <div>
                  <h3>{result.title.length === 0 ? result.url : result.title}</h3>
                  <span>{result.headingPath.length === 0 ? "root" : result.headingPath.join(" / ")}</span>
                </div>
                <a className="table-link" href={result.url} target="_blank" rel="noreferrer">
                  Open source
                </a>
              </div>
              <p>{result.snippet}</p>
              <div className="score-grid">
                <ScoreCell label="Score" value={result.score} />
                <ScoreCell label="Keyword" value={result.keywordScore} />
                <ScoreCell label="Vector" value={result.vectorScore} />
                <ScoreCell label="Rerank" value={result.rerankScore} />
              </div>
              <div className="detail-actions">
                <Link className="button button-secondary" to={`/sources/${encodeURIComponent(props.response.sourceId)}/pages/${result.pageId}`}>
                  Page detail
                </Link>
                <Link className="button button-secondary" to={`/sources/${encodeURIComponent(props.response.sourceId)}/chunks/${result.chunkId}`}>
                  Chunk detail
                </Link>
              </div>
            </li>
          ))}
        </ol>
      )}
      <RetrievalDiagnostics response={props.response} />
      <CitationList response={props.response} />
    </section>
  );
}

export function buildSearchRequest(form: SearchLabFormState): AdminSearchRequest | null {
  const query = form.query.trim();
  const sourceId = form.sourceId.trim();
  const limit = Number.isInteger(form.limit) ? Math.min(100, Math.max(1, form.limit)) : defaultSearchForm.limit;

  if (query.length === 0) {
    return null;
  }

  return {
    query,
    mode: form.mode,
    limit,
    ...(sourceId.length === 0 ? {} : { sourceId }),
    ...(form.forceRefresh ? { forceRefresh: true } : {})
  };
}

function WarningsList(props: { readonly warnings: AdminSearchResponse["warnings"] }) {
  return (
    <div className="warning-list">
      {props.warnings.map((warning) => (
        <div key={`${warning.code}:${warning.message}`}>
          <strong>{warning.code}</strong>
          <span>{warning.message}</span>
        </div>
      ))}
    </div>
  );
}

function RetrievalDiagnostics(props: { readonly response: AdminSearchResponse }) {
  return (
    <div className="detail-panel">
      <div className="detail-heading">
        <div>
          <h3>Retrieval diagnostics</h3>
          <span>{props.response.retrieval.queryHash}</span>
        </div>
        <StatusBadge tone="muted" label={props.response.retrieval.mode} />
      </div>
      <dl className="detail-grid">
        <DetailItem label="Keyword attempted" value={props.response.retrieval.keywordAttempted ? "yes" : "no"} />
        <DetailItem label="Vector attempted" value={props.response.retrieval.vectorAttempted ? "yes" : "no"} />
        <DetailItem label="Keyword results" value={formatCount(props.response.retrieval.keywordResultCount)} />
        <DetailItem label="Vector results" value={formatCount(props.response.retrieval.vectorResultCount)} />
        <DetailItem label="Merged results" value={formatCount(props.response.retrieval.mergedResultCount)} />
        <DetailItem label="Generated" value={formatDateTime(props.response.generatedAt)} />
      </dl>
    </div>
  );
}

function CitationList(props: { readonly response: AdminSearchResponse }) {
  if (props.response.sources.length === 0) {
    return null;
  }

  return (
    <div className="detail-panel">
      <div className="detail-heading">
        <div>
          <h3>Citations</h3>
          <span>{props.response.sources.length} cited sources</span>
        </div>
      </div>
      <ul className="citation-list">
        {props.response.sources.map((source) => (
          <li key={`${source.url}:${source.contentHash ?? ""}`}>
            <a className="table-link" href={source.url} target="_blank" rel="noreferrer">
              {source.title}
            </a>
            <span>{source.sourceType}</span>
            {source.contentHash === undefined ? null : <code>{source.contentHash}</code>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ScoreCell(props: { readonly label: string; readonly value: number }) {
  return (
    <div>
      <span>{props.label}</span>
      <strong>{props.value.toFixed(3)}</strong>
    </div>
  );
}

function DetailItem(props: { readonly label: string; readonly value: string }) {
  return (
    <div>
      <dt>{props.label}</dt>
      <dd>{props.value}</dd>
    </div>
  );
}

function InlineState(props: { readonly tone: "neutral" | "danger"; readonly title: string }) {
  return <div className={`inline-state inline-state-${props.tone}`}><strong>{props.title}</strong></div>;
}

function StatusBadge(props: { readonly tone: "good" | "muted" | "warn" | "danger"; readonly label: string }) {
  return <span className={`status-badge status-${props.tone}`}>{props.label}</span>;
}

function confidenceTone(confidence: AdminSearchResponse["confidence"]): "good" | "warn" | "danger" {
  return confidence === "high" ? "good" : confidence === "medium" ? "warn" : "danger";
}

function freshnessTone(freshness: AdminSearchResponse["freshness"]): "good" | "warn" | "danger" {
  return freshness === "fresh" ? "good" : freshness === "refreshing" ? "warn" : "danger";
}

function formatEnum(value: string): string {
  return value.replaceAll("_", " ");
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatDateTime(value: string): string {
  return value.replace("T", " ").slice(0, 16);
}
