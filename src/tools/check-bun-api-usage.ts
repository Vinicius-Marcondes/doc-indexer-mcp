import { createHash } from "node:crypto";
import * as z from "zod/v4";
import { citationIdForSource } from "../recommendations/finding-normalizer";
import {
  type AgentCitationMap,
  type AgentExample,
  type AgentFinding,
  type AgentResponseEnvelope,
  type AgentWarning,
  responseModeSchema
} from "../shared/agent-output";
import type { ResponseWarning } from "../shared/contracts";
import { createInvalidInputError, type StructuredError } from "../shared/errors";
import { applyResponseBudget } from "../shared/response-budget";
import { resolveProjectRoot } from "../security/project-paths";
import { BUN_DOCS_FULL_URL, type BunDocsSearchAdapter, type BunDocsSearchResultItem } from "../sources/bun-docs-search";

const checkBunApiUsageInputSchema = z
  .object({
    apiName: z.string().min(1),
    projectPath: z.string().min(1).optional(),
    usageSnippet: z.string().min(1).optional(),
    agentTrainingCutoff: z.string().min(1).optional(),
    responseMode: responseModeSchema.optional(),
    forceRefresh: z.boolean().optional()
  })
  .strict();

export interface CheckBunApiUsageDependencies {
  readonly docsAdapter: BunDocsSearchAdapter;
}

export interface CheckBunApiUsageFailure {
  readonly ok: false;
  readonly error: StructuredError;
}

export type UsageClassification = "current" | "outdated" | "risky" | "unknown";

export type CheckBunApiUsageSuccess = AgentResponseEnvelope & {
  readonly apiName: string;
  readonly usageClassification?: UsageClassification;
};

export type CheckBunApiUsageResult = CheckBunApiUsageSuccess | CheckBunApiUsageFailure;

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function exactApiMatch(result: BunDocsSearchResultItem, apiName: string): boolean {
  const needle = apiName.toLowerCase();
  const haystack = `${result.title} ${result.url} ${result.snippet}`.toLowerCase();
  return haystack.includes(needle);
}

function citationMapFor(results: readonly BunDocsSearchResultItem[], warningSources: readonly string[], fetchedAt: string): AgentCitationMap {
  const citations: AgentCitationMap = {};

  for (const result of results) {
    citations[citationIdForSource(result.url)] = {
      title: result.title,
      url: result.url,
      sourceType: "bun-docs",
      fetchedAt: result.fetchedAt
    };
  }

  for (const source of warningSources) {
    citations[citationIdForSource(source)] = {
      title: source === BUN_DOCS_FULL_URL ? "Bun full docs" : source,
      url: source,
      sourceType: "bun-docs",
      fetchedAt
    };
  }

  if (Object.keys(citations).length === 0) {
    citations[citationIdForSource(BUN_DOCS_FULL_URL)] = {
      title: "Bun full docs",
      url: BUN_DOCS_FULL_URL,
      sourceType: "bun-docs",
      fetchedAt
    };
  }

  return citations;
}

function findingFor(apiName: string, result: BunDocsSearchResultItem): AgentFinding {
  return {
    id: `bun-api-${apiName.replace(/[^a-z0-9]+/giu, "-").replace(/^-|-$/gu, "").toLowerCase()}`,
    ruleId: "bun-api-docs-match",
    framework: "bun",
    severity: "info",
    title: `${apiName} is documented in official Bun docs`,
    message: `Official Bun docs contain a matching section for ${apiName}.`,
    evidence: [result.snippet],
    locations: [],
    citationIds: [citationIdForSource(result.url)],
    fingerprint: fingerprint({
      apiName,
      url: result.url,
      snippet: result.snippet
    })
  };
}

function noMatchWarning(apiName: string): AgentWarning {
  return {
    id: "bun-api-no-official-docs-match",
    title: "No official Bun API match",
    message: `No official Bun documentation match was found for ${apiName}.`,
    evidence: [`apiName=${apiName}`],
    citationIds: [citationIdForSource(BUN_DOCS_FULL_URL)]
  };
}

function sourceDateUnavailableWarning(apiName: string, citationId: string): AgentWarning {
  return {
    id: "change-metadata-date-unavailable",
    title: "Source date unavailable for cutoff comparison",
    message: `The official Bun docs match for ${apiName} does not include release-date evidence, so no after-cutoff claim was made.`,
    evidence: [`apiName=${apiName}`],
    citationIds: [citationId]
  };
}

function docsWarningsToAgentWarnings(warnings: readonly ResponseWarning[]): AgentWarning[] {
  return warnings.map((warning) => ({
    id: warning.id,
    title: warning.title,
    message: warning.detail,
    evidence: warning.evidence,
    citationIds: warning.sources.map(citationIdForSource)
  }));
}

function exampleFor(apiName: string, citationId: string): AgentExample | null {
  if (apiName === "Bun.serve") {
    return {
      id: "example-bun-serve",
      title: "Minimal Bun.serve handler",
      language: "ts",
      code: 'Bun.serve({\n  fetch() {\n    return new Response("ok");\n  }\n});',
      citationIds: [citationId]
    };
  }

  if (apiName === "bun:test") {
    return {
      id: "example-bun-test",
      title: "Minimal bun:test import",
      language: "ts",
      code: 'import { expect, test } from "bun:test";\n\ntest("works", () => {\n  expect(1).toBe(1);\n});',
      citationIds: [citationId]
    };
  }

  return null;
}

function classifyUsage(apiName: string, usageSnippet: string | undefined, hasDocsMatch: boolean): UsageClassification | undefined {
  if (usageSnippet === undefined) {
    return undefined;
  }

  if (!hasDocsMatch) {
    return "unknown";
  }

  return usageSnippet.includes(apiName) ? "current" : "unknown";
}

function applyApiUsageBudget(response: AgentResponseEnvelope): AgentResponseEnvelope {
  const budgeted = applyResponseBudget(response);

  if (response.responseMode === "brief" && response.examples.length > 0) {
    return {
      ...budgeted,
      examples: response.examples.slice(0, 1)
    };
  }

  return budgeted;
}

export async function checkBunApiUsage(
  input: unknown,
  dependencies: CheckBunApiUsageDependencies
): Promise<CheckBunApiUsageResult> {
  const parsed = checkBunApiUsageInputSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      error: createInvalidInputError(parsed.error)
    };
  }

  if (parsed.data.projectPath !== undefined) {
    const root = resolveProjectRoot(parsed.data.projectPath);
    if (!root.ok) {
      return {
        ok: false,
        error: root.error
      };
    }
  }

  const docsResult = await dependencies.docsAdapter.search({ query: parsed.data.apiName, limit: 5 });

  if (!docsResult.ok) {
    return docsResult;
  }

  const relevantResults = docsResult.results.filter((result) => exactApiMatch(result, parsed.data.apiName));
  const firstResult = relevantResults[0];
  const generatedAt = new Date().toISOString();
  const docsWarningSources = docsResult.warnings.flatMap((warning) => warning.sources);
  const citations = citationMapFor(relevantResults, docsWarningSources, docsResult.sources[0]?.fetchedAt ?? generatedAt);
  const examples =
    firstResult === undefined ? [] : [exampleFor(parsed.data.apiName, citationIdForSource(firstResult.url))].filter(
      (example): example is AgentExample => example !== null
    );
  const findings = firstResult === undefined ? [] : [findingFor(parsed.data.apiName, firstResult)];
  const warnings = [
    ...docsWarningsToAgentWarnings(docsResult.warnings),
    ...(parsed.data.agentTrainingCutoff !== undefined && firstResult !== undefined
      ? [sourceDateUnavailableWarning(parsed.data.apiName, citationIdForSource(firstResult.url))]
      : []),
    ...(firstResult === undefined ? [noMatchWarning(parsed.data.apiName)] : [])
  ];
  const envelope: AgentResponseEnvelope = {
    ok: true,
    schemaVersion: "agent-output-v1",
    generatedAt,
    responseMode: parsed.data.responseMode ?? "brief",
    summary:
      firstResult === undefined
        ? `No official Bun docs match ${parsed.data.apiName}; do not infer current usage from model memory.`
        : `Official Bun docs match ${parsed.data.apiName}: ${firstResult.title}.`,
    cacheStatus: docsResult.cacheStatus,
    confidence: firstResult === undefined ? "low" : docsResult.confidence,
    findings,
    actions: [],
    examples,
    citations,
    warnings
  };
  const classification = classifyUsage(parsed.data.apiName, parsed.data.usageSnippet, firstResult !== undefined);

  return {
    ...applyApiUsageBudget(envelope),
    apiName: parsed.data.apiName,
    ...(classification === undefined ? {} : { usageClassification: classification })
  };
}
