import { createHash } from "node:crypto";
import type { AgentCitation, AgentCitationMap } from "../shared/agent-output";
import type { SourceCitation } from "../shared/contracts";

export interface LocalEvidenceCitationInput {
  readonly kind: "local";
  readonly label: string;
  readonly fetchedAt: string;
  readonly contentHash?: string;
}

export type CitationMapInput = SourceCitation | LocalEvidenceCitationInput;

export interface CitationMapBuildResult {
  readonly citations: AgentCitationMap;
  readonly citationIdsBySource: Record<string, string>;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sanitizeLocalLabel(label: string): string {
  return label.replace(/[^a-z0-9]+/giu, "-").replace(/^-|-$/gu, "").toLowerCase();
}

export function citationIdForSource(source: string): string {
  if (source.startsWith("local-project:")) {
    const label = sanitizeLocalLabel(source.slice("local-project:".length));
    return `local-${label}`;
  }

  return `source-${sha256(source).slice(0, 12)}`;
}

function sourceFromInput(input: CitationMapInput): SourceCitation {
  if ("kind" in input) {
    return {
      title: input.label,
      url: `local-project:${input.label}`,
      sourceType: "local-project",
      fetchedAt: input.fetchedAt,
      ...(input.contentHash === undefined ? {} : { contentHash: input.contentHash })
    };
  }

  return input;
}

function dedupeKey(citation: SourceCitation): string {
  return [citation.url, citation.sourceType, citation.contentHash ?? "", citation.title].join("\0");
}

function nextRemoteId(index: number): string {
  return `c${index}`;
}

export function buildCitationMap(inputs: readonly CitationMapInput[]): CitationMapBuildResult {
  const citations: AgentCitationMap = {};
  const citationIdsBySource: Record<string, string> = {};
  const idsByDedupeKey = new Map<string, string>();
  let nextId = 1;

  for (const input of inputs) {
    const source = sourceFromInput(input);
    const key = dedupeKey(source);
    const existingId = idsByDedupeKey.get(key);

    if (existingId !== undefined) {
      citationIdsBySource[source.url] = existingId;
      continue;
    }

    const citationId = source.sourceType === "local-project" ? citationIdForSource(source.url) : nextRemoteId(nextId++);
    idsByDedupeKey.set(key, citationId);
    citationIdsBySource[source.url] = citationId;
    citations[citationId] = {
      title: source.title,
      url: source.url,
      sourceType: source.sourceType,
      fetchedAt: source.fetchedAt,
      ...(source.contentHash === undefined ? {} : { contentHash: source.contentHash })
    };
  }

  return {
    citations,
    citationIdsBySource
  };
}
