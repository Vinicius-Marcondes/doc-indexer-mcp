import * as z from "zod/v4";
import type { BunDocsSearchAdapter } from "../sources/bun-docs-search";
import type { Recommendation, SourceCitation } from "../shared/contracts";
import { createInvalidInputError, type StructuredError } from "../shared/errors";
import { analyzeBunProject } from "./analyze-bun-project";

const bestPracticeTopicSchema = z.enum([
  "typescript",
  "dependencies",
  "lockfile",
  "tests",
  "workspaces",
  "runtime",
  "bundler",
  "deployment",
  "security"
]);

const bestPracticeInputSchema = z
  .object({
    topic: bestPracticeTopicSchema,
    projectPath: z.string().min(1).optional(),
    forceRefresh: z.boolean().optional()
  })
  .strict();

export interface GetBunBestPracticesDependencies {
  readonly docsAdapter: BunDocsSearchAdapter;
}

export interface ProjectFit {
  readonly projectPath: string;
  readonly packageManager: string;
  readonly recommendationIds: string[];
}

export interface GetBunBestPracticesSuccess {
  readonly ok: true;
  readonly generatedAt: string;
  readonly topic: z.infer<typeof bestPracticeTopicSchema>;
  readonly projectFit?: ProjectFit;
  readonly recommendations: Recommendation[];
  readonly warnings: ReturnType<BunDocsSearchAdapter["search"]> extends Promise<infer Result>
    ? Result extends { ok: true; warnings: infer W }
      ? W
      : never
    : never;
  readonly sources: SourceCitation[];
  readonly cacheStatus: string;
  readonly confidence: string;
}

export interface GetBunBestPracticesFailure {
  readonly ok: false;
  readonly error: StructuredError;
}

export type GetBunBestPracticesResult = GetBunBestPracticesSuccess | GetBunBestPracticesFailure;

function queryFor(topic: z.infer<typeof bestPracticeTopicSchema>): string {
  switch (topic) {
    case "typescript":
      return "@types/bun types bun moduleResolution bundler module Preserve target ESNext noEmit";
    case "lockfile":
      return "bun.lock bun.lockb lockfile";
    case "tests":
      return "bun test bun:test";
    case "dependencies":
      return "bun add dependencies package manager";
    case "workspaces":
      return "bun workspaces package.json workspaces";
    case "runtime":
      return "Bun.serve Bun.file Bun runtime APIs";
    case "bundler":
      return "Bun bundler build";
    case "deployment":
      return "Bun deployment";
    case "security":
      return "Bun security";
  }
}

function docsTopic(topic: z.infer<typeof bestPracticeTopicSchema>) {
  if (topic === "lockfile" || topic === "dependencies") {
    return "package-manager" as const;
  }

  if (topic === "tests") {
    return "test-runner" as const;
  }

  return topic;
}

function sourceUrls(sources: SourceCitation[]): string[] {
  return sources.length > 0 ? sources.map((source) => source.url) : ["https://bun.com/docs/"];
}

function bestPracticeRecommendations(
  topic: z.infer<typeof bestPracticeTopicSchema>,
  sources: SourceCitation[]
): Recommendation[] {
  const urls = sourceUrls(sources);

  if (topic === "typescript") {
    return [
      {
        id: "best-practice-typescript-bun-types",
        severity: "info",
        title: "Use Bun TypeScript definitions",
        detail: 'Bun TypeScript projects should include @types/bun and configure compilerOptions.types with "bun" when types are restricted.',
        evidence: ["Official Bun TypeScript docs matched the TypeScript best-practices query."],
        sources: urls,
        recommendedAction: 'Add @types/bun and types: ["bun"] when Bun APIs are used.'
      },
      {
        id: "best-practice-typescript-compiler-options",
        severity: "info",
        title: "Review Bun TypeScript compiler options",
        detail: "Bun guidance favors moduleResolution bundler, module Preserve, target ESNext, and noEmit true for type checking.",
        evidence: ["Official Bun TypeScript docs matched compiler option guidance."],
        sources: urls,
        recommendedAction: "Align tsconfig with Bun guidance when it fits the project."
      }
    ];
  }

  if (topic === "lockfile") {
    return [
      {
        id: "best-practice-lockfile-bun-lock",
        severity: "info",
        title: "Prefer current Bun text lockfile",
        detail: "Bun projects should use the current bun.lock text lockfile and treat legacy bun.lockb as migration evidence.",
        evidence: ["Official Bun lockfile docs matched the lockfile best-practices query."],
        sources: urls,
        recommendedAction: "Use bun.lock as the package-manager lockfile unless the project intentionally differs."
      }
    ];
  }

  if (topic === "tests") {
    return [
      {
        id: "best-practice-tests-bun-test",
        severity: "info",
        title: "Use bun:test for Bun-native tests",
        detail: "Bun projects can use bun test with imports from bun:test.",
        evidence: ["Official Bun test docs matched the tests best-practices query."],
        sources: urls,
        recommendedAction: "Prefer bun test when the project is Bun-first and tests import bun:test."
      }
    ];
  }

  return [
    {
      id: `best-practice-${topic}`,
      severity: "info",
      title: `Review Bun ${topic} guidance`,
      detail: "Official Bun documentation matched this best-practices topic.",
      evidence: [`Official Bun docs matched topic=${topic}.`],
      sources: urls,
      recommendedAction: "Use the cited Bun documentation as evidence before editing project files."
    }
  ];
}

export async function getBunBestPractices(
  input: unknown,
  dependencies: GetBunBestPracticesDependencies
): Promise<GetBunBestPracticesResult> {
  const parsed = bestPracticeInputSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      error: createInvalidInputError(parsed.error)
    };
  }

  const docs = await dependencies.docsAdapter.search({
    query: queryFor(parsed.data.topic),
    topic: docsTopic(parsed.data.topic)
  });

  if (!docs.ok) {
    return docs;
  }

  let projectFit: ProjectFit | undefined;

  if (parsed.data.projectPath !== undefined) {
    const project = analyzeBunProject({ projectPath: parsed.data.projectPath });

    if (!project.ok) {
      return project;
    }

    projectFit = {
      projectPath: project.projectPath,
      packageManager: project.packageManager.name,
      recommendationIds: project.recommendations.map((recommendation) => recommendation.id)
    };
  }

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    topic: parsed.data.topic,
    ...(projectFit === undefined ? {} : { projectFit }),
    recommendations: bestPracticeRecommendations(parsed.data.topic, docs.sources),
    warnings: docs.warnings,
    sources: docs.sources,
    cacheStatus: docs.cacheStatus,
    confidence: docs.confidence
  };
}
