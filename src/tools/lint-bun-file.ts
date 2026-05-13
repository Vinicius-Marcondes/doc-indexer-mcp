import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { relative, resolve } from "node:path";
import * as z from "zod/v4";
import { analyzeBunGlobals, type BunGlobalFinding } from "../analyzers/ast-bun-globals";
import { analyzeImports, type ImportFinding } from "../analyzers/ast-imports";
import { parsePackageJson } from "../analyzers/package-json";
import { parseTsconfig } from "../analyzers/tsconfig";
import { createActionFromRecommendation } from "../recommendations/actions";
import { citationIdForSource, normalizeRecommendationsToFindings } from "../recommendations/finding-normalizer";
import { generateProjectRecommendations } from "../recommendations/rules";
import {
  type AgentAction,
  type AgentCitation,
  type AgentCitationMap,
  type AgentFinding,
  type AgentResponseEnvelope,
  responseModeSchema
} from "../shared/agent-output";
import type { Recommendation } from "../shared/contracts";
import { createInvalidInputError, createStructuredError, type StructuredError } from "../shared/errors";
import { hashProjectPath } from "../shared/project-hash";
import { applyResponseBudget } from "../shared/response-budget";
import { readTextFileIfAllowed, shouldIgnorePath } from "../security/ignore-policy";
import { resolvePathWithinProject, resolveProjectRoot } from "../security/project-paths";

const lintBunFileInputSchema = z
  .object({
    projectPath: z.string().min(1),
    filePath: z.string().min(1),
    responseMode: responseModeSchema.optional()
  })
  .strict();

export interface LintBunFileFailure {
  readonly ok: false;
  readonly error: StructuredError;
}

export type LintBunFileSuccess = AgentResponseEnvelope & {
  readonly filePath: string;
  readonly fileFacts?: {
    readonly bunGlobals: ReturnType<typeof analyzeBunGlobals>;
    readonly imports: ReturnType<typeof analyzeImports>;
  };
};

export type LintBunFileResult = LintBunFileSuccess | LintBunFileFailure;

function unsafeFileError(reason: string, label?: string): LintBunFileFailure {
  return {
    ok: false,
    error: createStructuredError("unsafe_path", "Requested file is not safe to analyze.", {
      reason,
      ...(label === undefined ? {} : { label })
    })
  };
}

function normalizedRelativePath(projectRoot: string, path: string): string {
  return relative(projectRoot, path).split(/\\/u).join("/");
}

function sourceTypeFor(source: string): AgentCitation["sourceType"] {
  if (source.startsWith("local-project:")) {
    return "local-project";
  }

  return "bun-docs";
}

function titleForSource(source: string): string {
  if (source.startsWith("local-project:")) {
    return source.slice("local-project:".length);
  }

  if (source === "https://bun.com/docs/test") {
    return "Bun test docs";
  }

  if (source.includes("/api/http")) {
    return "Bun HTTP server docs";
  }

  if (source.includes("/runtime/typescript")) {
    return "Bun TypeScript docs";
  }

  return source;
}

function citationMapFor(sources: readonly string[], generatedAt: string): AgentCitationMap {
  const citations: AgentCitationMap = {};

  for (const source of sources) {
    citations[citationIdForSource(source)] = {
      title: titleForSource(source),
      url: source,
      sourceType: sourceTypeFor(source),
      fetchedAt: generatedAt
    };
  }

  return citations;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function bunGlobalDocSource(finding: BunGlobalFinding): string {
  if (finding.member === "serve") {
    return "https://bun.com/docs/api/http";
  }

  if (finding.member === "file" || finding.member === "write") {
    return "https://bun.com/docs/api/file-io";
  }

  if (finding.member === "spawn") {
    return "https://bun.com/docs/api/spawn";
  }

  if (finding.member === "password") {
    return "https://bun.com/docs/api/hashing";
  }

  return "https://bun.com/docs/runtime/env";
}

function bunGlobalFinding(finding: BunGlobalFinding, projectHash: string): AgentFinding {
  const source = bunGlobalDocSource(finding);
  const evidence = `Detected Bun.${finding.member} at ${finding.relativePath}:${finding.line}`;

  return {
    id: `bun-global-${finding.member}-${finding.line}`,
    ruleId: "bun-global-usage",
    framework: "bun",
    severity: "info",
    title: `Review Bun.${finding.member} usage`,
    message: `This file uses Bun.${finding.member}; keep edits aligned with official Bun API behavior.`,
    evidence: [evidence],
    locations: [{ filePath: finding.relativePath, line: finding.line }],
    citationIds: [citationIdForSource(source)],
    fingerprint: fingerprint({ projectHash, ruleId: "bun-global-usage", evidence, source })
  };
}

function bunImportFinding(finding: ImportFinding, projectHash: string): AgentFinding | null {
  if (finding.kind !== "bun-test" && finding.kind !== "bun-sqlite" && finding.kind !== "bun") {
    return null;
  }

  const source = finding.kind === "bun-test" ? "https://bun.com/docs/test" : "https://bun.com/docs/api";
  const evidence = `Detected ${finding.specifier} import at ${finding.relativePath}:${finding.line}`;

  return {
    id: `bun-import-${finding.specifier.replace(/[^a-z0-9]+/giu, "-").replace(/^-|-$/gu, "").toLowerCase()}-${finding.line}`,
    ruleId: finding.kind === "bun-test" ? "bun-test-import" : "bun-import",
    framework: "bun",
    severity: "info",
    title: `Review ${finding.specifier} import`,
    message: `This file imports ${finding.specifier}; keep edits aligned with official Bun module behavior.`,
    evidence: [evidence],
    locations: [{ filePath: finding.relativePath, line: finding.line }],
    citationIds: [citationIdForSource(source)],
    fingerprint: fingerprint({ projectHash, ruleId: "bun-import", evidence, source })
  };
}

function summaryFor(relativePath: string, findingsCount: number): string {
  const findingText = findingsCount === 1 ? "1 Bun-specific finding" : `${findingsCount} Bun-specific findings`;
  return `${relativePath}: ${findingText}. Suggested edits are recommendations only and were not applied.`;
}

function actionsFor(recommendations: readonly Recommendation[], findings: readonly AgentFinding[]): AgentAction[] {
  return recommendations
    .map((recommendation) => {
      const finding = findings.find((item) => item.id === recommendation.id);
      return finding === undefined ? null : createActionFromRecommendation(recommendation, finding);
    })
    .filter((action): action is AgentAction => action !== null);
}

export function lintBunFile(input: unknown): LintBunFileResult {
  const parsed = lintBunFileInputSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      error: createInvalidInputError(parsed.error)
    };
  }

  const root = resolveProjectRoot(parsed.data.projectPath);

  if (!root.ok) {
    return root;
  }

  const requestedPath = resolve(root.projectRoot, parsed.data.filePath);
  const requestedDecision = shouldIgnorePath(requestedPath, "file");

  if (requestedDecision.ignored) {
    return unsafeFileError(requestedDecision.reason ?? "ignored_path", requestedDecision.label);
  }

  const safePath = resolvePathWithinProject(root, parsed.data.filePath);

  if (!safePath.ok) {
    return safePath;
  }

  const realDecision = shouldIgnorePath(safePath.realPath, "file");

  if (realDecision.ignored) {
    return unsafeFileError(realDecision.reason ?? "ignored_path", realDecision.label);
  }

  if (!statSync(safePath.realPath).isFile()) {
    return unsafeFileError("not_file");
  }

  const readResult = readTextFileIfAllowed(safePath.realPath);

  if (!readResult.ok) {
    return unsafeFileError(readResult.skipped.reason ?? "ignored_path", readResult.skipped.label);
  }

  const packageResult = parsePackageJson(root.projectRoot);
  if (!packageResult.ok) {
    return packageResult;
  }

  const tsconfigResult = parseTsconfig(root.projectRoot);
  if (!tsconfigResult.ok) {
    return tsconfigResult;
  }

  const generatedAt = new Date().toISOString();
  const relativePath = normalizedRelativePath(root.projectRoot, safePath.realPath);
  const inputFile = [{ path: safePath.realPath, relativePath }];
  const bunGlobals = analyzeBunGlobals(inputFile);
  const imports = analyzeImports(inputFile);
  const projectHash = hashProjectPath(root.projectRoot);
  const recommendations = generateProjectRecommendations({
    packageJson: packageResult.packageJson,
    tsconfig: tsconfigResult.tsconfig,
    bunGlobals
  });
  const recommendationSources = recommendations.flatMap((recommendation) => recommendation.sources);
  const customFindings = [
    ...bunGlobals.findings.map((finding) => bunGlobalFinding(finding, projectHash)),
    ...imports.imports.map((finding) => bunImportFinding(finding, projectHash)).filter((finding): finding is AgentFinding => finding !== null)
  ];
  const citationSources = [
    ...recommendationSources,
    ...customFindings.flatMap((finding) =>
      finding.citationIds.map((citationId) => {
        if (citationId === citationIdForSource("https://bun.com/docs/api/http")) {
          return "https://bun.com/docs/api/http";
        }

        if (citationId === citationIdForSource("https://bun.com/docs/api/file-io")) {
          return "https://bun.com/docs/api/file-io";
        }

        if (citationId === citationIdForSource("https://bun.com/docs/api/spawn")) {
          return "https://bun.com/docs/api/spawn";
        }

        if (citationId === citationIdForSource("https://bun.com/docs/api/hashing")) {
          return "https://bun.com/docs/api/hashing";
        }

        if (citationId === citationIdForSource("https://bun.com/docs/runtime/env")) {
          return "https://bun.com/docs/runtime/env";
        }

        if (citationId === citationIdForSource("https://bun.com/docs/test")) {
          return "https://bun.com/docs/test";
        }

        return "https://bun.com/docs/api";
      })
    )
  ];
  const citations = citationMapFor(citationSources, generatedAt);
  const citationIdsBySource = Object.fromEntries(recommendationSources.map((source) => [source, citationIdForSource(source)] as const));
  const recommendationFindings = normalizeRecommendationsToFindings(recommendations, {
    projectHash,
    scope: relativePath,
    citationIdsBySource
  });
  const findings = [...customFindings, ...recommendationFindings];
  const envelope: AgentResponseEnvelope = {
    ok: true,
    schemaVersion: "agent-output-v1",
    generatedAt,
    responseMode: parsed.data.responseMode ?? "brief",
    summary: summaryFor(relativePath, findings.length),
    cacheStatus: "disabled",
    confidence: findings.length === 0 ? "medium" : "high",
    findings,
    actions: actionsFor(recommendations, recommendationFindings),
    examples: [],
    citations,
    warnings: []
  };
  const budgeted = applyResponseBudget(envelope);

  return {
    ...budgeted,
    filePath: relativePath,
    ...(parsed.data.responseMode === "full" ? { fileFacts: { bunGlobals, imports } } : {})
  };
}
