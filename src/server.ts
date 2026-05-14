import { resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { performance } from "node:perf_hooks";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { SqliteCacheStore } from "./cache/sqlite-cache";
import { FindingCacheStore } from "./cache/finding-cache";
import { createAuditLogger, type AuditLogEnv, type AuditLogger } from "./logging/audit-logger";
import { analyzeBunProject } from "./tools/analyze-bun-project";
import { searchDocs, searchDocsInputSchema, type SearchDocsRetrieval } from "./tools/search-docs";
import { searchBunDocs } from "./tools/search-bun-docs";
import { getBunBestPractices } from "./tools/get-bun-best-practices";
import { planBunDependency } from "./tools/plan-bun-dependency";
import { reviewBunProject } from "./tools/review-bun-project";
import { projectHealth } from "./tools/project-health";
import { checkBeforeInstall } from "./tools/check-before-install";
import { checkBunApiUsage } from "./tools/check-bun-api-usage";
import { lintBunFile } from "./tools/lint-bun-file";
import { responseModeSchema } from "./shared/agent-output";
import { SourceFetchClient, type FetchLike } from "./sources/fetch-client";
import { BunDocsIndexAdapter } from "./sources/bun-docs-index";
import { BunDocsSearchAdapter } from "./sources/bun-docs-search";
import { BunDocsPageAdapter } from "./sources/bun-docs-page";
import { NpmRegistryAdapter } from "./sources/npm-registry";
import {
  BUN_DOCS_INDEX_RESOURCE_URI,
  bunDocsIndexResource,
  readBunDocsIndexResource
} from "./resources/bun-docs-index-resource";
import {
  BUN_DOCS_PAGE_RESOURCE_URI_TEMPLATE,
  bunDocsPageResourceTemplate,
  readBunDocsPageResource
} from "./resources/bun-docs-page-resource";
import {
  BUN_PROJECT_ANALYSIS_RESOURCE_URI_TEMPLATE,
  bunProjectAnalysisResourceTemplate,
  readBunProjectAnalysisResource
} from "./resources/bun-project-analysis-resource";
import {
  BUN_PROJECT_FINDINGS_RESOURCE_URI_TEMPLATE,
  bunProjectFindingsResourceTemplate,
  readBunProjectFindingsResource
} from "./resources/bun-project-findings-resource";
import { ProjectAnalysisStore } from "./resources/project-analysis-store";
import type { RemoteDocsConfig } from "./config/remote-docs-config";
import { createPostgresClient } from "./docs/storage/database";
import { RemoteDocsStorage } from "./docs/storage/docs-storage";
import { PostgresKeywordRetrieval } from "./docs/retrieval/keyword-retrieval";
import { PostgresVectorRetrieval } from "./docs/retrieval/vector-retrieval";
import { HybridDocsRetrieval } from "./docs/retrieval/hybrid-retrieval";
import { createOpenAiEmbeddingProviderFromConfig } from "./docs/embeddings/openai-provider";
import { defaultDocsSourceRegistry } from "./docs/sources/bun-source-pack";
import type { DocsSourceRegistry } from "./docs/sources/registry";

export interface ServerMetadata {
  readonly name: string;
  readonly version: string;
}

export const serverMetadata: ServerMetadata = {
  name: "bun-dev-intel-mcp",
  version: "0.1.0"
};

export interface ServerDependencies {
  readonly cache: SqliteCacheStore;
  readonly findingCacheStore: FindingCacheStore;
  readonly fetchClient: SourceFetchClient;
  readonly bunDocsIndexAdapter: BunDocsIndexAdapter;
  readonly bunDocsSearchAdapter: BunDocsSearchAdapter;
  readonly bunDocsPageAdapter: BunDocsPageAdapter;
  readonly npmRegistryAdapter: NpmRegistryAdapter;
  readonly projectAnalysisStore: ProjectAnalysisStore;
  readonly docsSourceRegistry: DocsSourceRegistry;
  readonly docsRetrieval?: SearchDocsRetrieval;
  readonly docsSearchDefaults: {
    readonly defaultLimit: number;
    readonly maxLimit: number;
  };
  readonly auditLogger: AuditLogger;
  readonly now: () => string;
}

export interface ServerDependencyOptions {
  readonly cachePath?: string;
  readonly fetchImpl?: FetchLike;
  readonly now?: () => string;
  readonly env?: AuditLogEnv;
  readonly auditLogger?: AuditLogger;
  readonly docsSourceRegistry?: DocsSourceRegistry;
  readonly docsRetrieval?: SearchDocsRetrieval;
  readonly docsSearchDefaults?: {
    readonly defaultLimit: number;
    readonly maxLimit: number;
  };
}

export function defaultCachePath(): string {
  const cacheDir = resolve(homedir(), ".cache", "bun-dev-intel-mcp");
  mkdirSync(cacheDir, { recursive: true });
  return resolve(cacheDir, "cache.sqlite");
}

export interface BunDevIntelRegistrar {
  readonly registerTool: (name: string, config: Record<string, unknown>, handler: (input: unknown) => unknown) => unknown;
  readonly registerResource: (
    name: string,
    uriOrTemplate: unknown,
    config: Record<string, unknown>,
    handler: (...args: unknown[]) => unknown
  ) => unknown;
}

export interface ToolManifestEntry {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: z.ZodType;
}

export interface ResourceManifestEntry {
  readonly name: string;
  readonly description: string;
  readonly mimeType: "application/json";
  readonly uri?: string;
  readonly uriTemplate?: string;
}

export interface ServerCapabilityManifest {
  readonly tools: ToolManifestEntry[];
  readonly resources: ResourceManifestEntry[];
}

type ToolHandler = (input: unknown, dependencies: ServerDependencies) => unknown;

interface ToolRegistration extends ToolManifestEntry {
  readonly handler: ToolHandler;
}

interface ResourceRegistration extends ResourceManifestEntry {
  readonly register: (registrar: BunDevIntelRegistrar, dependencies: ServerDependencies) => void;
}

const topicSchema = z.enum([
  "runtime",
  "package-manager",
  "test-runner",
  "bundler",
  "typescript",
  "workspaces",
  "deployment",
  "security",
  "unknown"
]);

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

const focusSchema = z.enum(["typescript", "dependencies", "tests", "lockfile", "runtime", "all"]);

const packageRequestSchema = z.object({
  name: z.string().min(1),
  requestedRange: z.string().min(1).optional()
});

const analyzeBunProjectInputSchema = z
  .object({
    projectPath: z.string().min(1),
    forceRefresh: z.boolean().optional()
  })
  .strict();

const searchBunDocsInputSchema = z
  .object({
    query: z.string().min(1),
    topic: topicSchema.optional(),
    forceRefresh: z.boolean().optional()
  })
  .strict();

const getBunBestPracticesInputSchema = z
  .object({
    topic: bestPracticeTopicSchema,
    projectPath: z.string().min(1).optional(),
    forceRefresh: z.boolean().optional()
  })
  .strict();

const planBunDependencyInputSchema = z
  .object({
    projectPath: z.string().min(1),
    packages: z.array(packageRequestSchema).min(1),
    dependencyType: z.enum(["dependencies", "devDependencies", "optionalDependencies"]).optional(),
    responseMode: responseModeSchema.optional()
  })
  .strict();

const reviewBunProjectInputSchema = z
  .object({
    projectPath: z.string().min(1),
    focus: focusSchema.optional(),
    responseMode: responseModeSchema.optional()
  })
  .strict();

const projectHealthInputSchema = z
  .object({
    projectPath: z.string().min(1),
    focus: focusSchema.optional(),
    responseMode: responseModeSchema.optional(),
    sinceToken: z.string().min(1).optional(),
    forceRefresh: z.boolean().optional()
  })
  .strict();

const checkBeforeInstallInputSchema = z
  .object({
    projectPath: z.string().min(1),
    packages: z.array(packageRequestSchema).min(1),
    dependencyType: z.enum(["dependencies", "devDependencies", "optionalDependencies"]).optional(),
    responseMode: responseModeSchema.optional(),
    forceRefresh: z.boolean().optional()
  })
  .strict();

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

const lintBunFileInputSchema = z
  .object({
    projectPath: z.string().min(1),
    filePath: z.string().min(1),
    responseMode: responseModeSchema.optional()
  })
  .strict();

const toolRegistrations: ToolRegistration[] = [
  {
    name: "project_health",
    description: "brief V2 project health scan for planning; returns ranked findings, actions, citations, and delta tokens.",
    inputSchema: projectHealthInputSchema,
    handler: (input, dependencies) =>
      projectHealth(input, {
        analysisStore: dependencies.projectAnalysisStore,
        findingCache: dependencies.findingCacheStore,
        now: dependencies.now
      })
  },
  {
    name: "check_before_install",
    description: "Check packages before editing dependencies; returns npm-backed findings and approval-gated install actions.",
    inputSchema: checkBeforeInstallInputSchema,
    handler: (input, dependencies) =>
      checkBeforeInstall(input, {
        registryAdapter: dependencies.npmRegistryAdapter,
        now: dependencies.now
      })
  },
  {
    name: "check_bun_api_usage",
    description: "Check a Bun API against official docs; returns compact guidance, citations, and at most one example.",
    inputSchema: checkBunApiUsageInputSchema,
    handler: (input, dependencies) => checkBunApiUsage(input, { docsAdapter: dependencies.bunDocsSearchAdapter })
  },
  {
    name: "lint_bun_file",
    description: "Lint one file for Bun-specific API, import, type, and safety findings without mutating the project.",
    inputSchema: lintBunFileInputSchema,
    handler: (input) => lintBunFile(input)
  },
  {
    name: "analyze_bun_project",
    description: "Full raw project analysis; agents should prefer project_health for compact planning.",
    inputSchema: analyzeBunProjectInputSchema,
    handler: (input, dependencies) =>
      analyzeBunProject(input, {
        analysisStore: dependencies.projectAnalysisStore,
        now: dependencies.now
      })
  },
  {
    name: "search_bun_docs",
    description: "Search official Bun documentation and return cited, cache-aware excerpts.",
    inputSchema: searchBunDocsInputSchema,
    handler: (input, dependencies) => searchBunDocs(input, { adapter: dependencies.bunDocsSearchAdapter })
  },
  {
    name: "get_bun_best_practices",
    description: "Return Bun-specific best-practice recommendations for a topic, optionally project-tailored.",
    inputSchema: getBunBestPracticesInputSchema,
    handler: (input, dependencies) => getBunBestPractices(input, { docsAdapter: dependencies.bunDocsSearchAdapter })
  },
  {
    name: "plan_bun_dependency",
    description: "Compatibility dependency planner; agents should prefer check_before_install before package edits.",
    inputSchema: planBunDependencyInputSchema,
    handler: (input, dependencies) => planBunDependency(input, { registryAdapter: dependencies.npmRegistryAdapter })
  },
  {
    name: "review_bun_project",
    description: "Produce an agent-ready Bun project context packet with risks, next actions, and citations.",
    inputSchema: reviewBunProjectInputSchema,
    handler: (input) => reviewBunProject(input)
  }
];

const searchDocsRegistration: ToolRegistration = {
  name: "search_docs",
  description: "Search indexed official docs with hybrid keyword and semantic retrieval; remote docs only.",
  inputSchema: searchDocsInputSchema,
  handler: (input, dependencies) =>
    searchDocs(input, {
      retrieval: dependencies.docsRetrieval,
      sourceRegistry: dependencies.docsSourceRegistry,
      now: dependencies.now,
      defaultLimit: dependencies.docsSearchDefaults.defaultLimit,
      maxLimit: dependencies.docsSearchDefaults.maxLimit
    })
};

function jsonText(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function toMcpToolResult(value: unknown): {
  readonly structuredContent: unknown;
  readonly content: readonly [{ readonly type: "text"; readonly text: string }];
} {
  return {
    structuredContent: value,
    content: [
      {
        type: "text",
        text: jsonText(value)
      }
    ]
  };
}

function toMcpResourceResult(uri: string, value: unknown): {
  readonly contents: readonly [{ readonly uri: string; readonly mimeType: "application/json"; readonly text: string }];
} {
  return {
    contents: [
      {
        uri,
        mimeType: "application/json",
        text: jsonText(value)
      }
    ]
  };
}

function docsPageSlugFromUri(uri: URL): string {
  return decodeURIComponent(uri.href.replace("bun-docs://page/", ""));
}

function projectHashFromUri(uri: URL): string {
  return uri.href.replace("bun-project://analysis/", "");
}

function projectFindingsHashFromUri(uri: URL): string {
  return uri.href.replace("bun-project://findings/", "");
}

const resourceRegistrations: ResourceRegistration[] = [
  {
    name: bunDocsIndexResource.name,
    description: bunDocsIndexResource.description,
    mimeType: bunDocsIndexResource.mimeType,
    uri: bunDocsIndexResource.uri,
    register: (registrar, dependencies) => {
      registrar.registerResource(
        bunDocsIndexResource.name,
        BUN_DOCS_INDEX_RESOURCE_URI,
        {
          title: "Bun docs index",
          description: bunDocsIndexResource.description,
          mimeType: bunDocsIndexResource.mimeType
        },
        async (uri: unknown) =>
          toMcpResourceResult(
            uri instanceof URL ? uri.href : BUN_DOCS_INDEX_RESOURCE_URI,
            await readBunDocsIndexResource({ adapter: dependencies.bunDocsIndexAdapter })
          )
      );
    }
  },
  {
    name: bunDocsPageResourceTemplate.name,
    description: bunDocsPageResourceTemplate.description,
    mimeType: bunDocsPageResourceTemplate.mimeType,
    uriTemplate: bunDocsPageResourceTemplate.uriTemplate,
    register: (registrar, dependencies) => {
      registrar.registerResource(
        bunDocsPageResourceTemplate.name,
        new ResourceTemplate(BUN_DOCS_PAGE_RESOURCE_URI_TEMPLATE, { list: undefined }),
        {
          title: "Bun docs page",
          description: bunDocsPageResourceTemplate.description,
          mimeType: bunDocsPageResourceTemplate.mimeType
        },
        async (uri: unknown) => {
          const resourceUri = uri instanceof URL ? uri : new URL("bun-docs://page/");
          return toMcpResourceResult(
            resourceUri.href,
            await readBunDocsPageResource(
              { slug: docsPageSlugFromUri(resourceUri) },
              { adapter: dependencies.bunDocsPageAdapter }
            )
          );
        }
      );
    }
  },
  {
    name: bunProjectAnalysisResourceTemplate.name,
    description: bunProjectAnalysisResourceTemplate.description,
    mimeType: bunProjectAnalysisResourceTemplate.mimeType,
    uriTemplate: bunProjectAnalysisResourceTemplate.uriTemplate,
    register: (registrar, dependencies) => {
      registrar.registerResource(
        bunProjectAnalysisResourceTemplate.name,
        new ResourceTemplate(BUN_PROJECT_ANALYSIS_RESOURCE_URI_TEMPLATE, { list: undefined }),
        {
          title: "Bun project analysis",
          description: bunProjectAnalysisResourceTemplate.description,
          mimeType: bunProjectAnalysisResourceTemplate.mimeType
        },
        (uri: unknown) => {
          const resourceUri = uri instanceof URL ? uri : new URL("bun-project://analysis/");
          return toMcpResourceResult(
            resourceUri.href,
            readBunProjectAnalysisResource(
              { projectHash: projectHashFromUri(resourceUri) },
              {
                store: dependencies.projectAnalysisStore,
                now: dependencies.now
              }
            )
          );
        }
      );
    }
  },
  {
    name: bunProjectFindingsResourceTemplate.name,
    description: bunProjectFindingsResourceTemplate.description,
    mimeType: bunProjectFindingsResourceTemplate.mimeType,
    uriTemplate: bunProjectFindingsResourceTemplate.uriTemplate,
    register: (registrar, dependencies) => {
      registrar.registerResource(
        bunProjectFindingsResourceTemplate.name,
        new ResourceTemplate(BUN_PROJECT_FINDINGS_RESOURCE_URI_TEMPLATE, { list: undefined }),
        {
          title: "Bun project findings",
          description: bunProjectFindingsResourceTemplate.description,
          mimeType: bunProjectFindingsResourceTemplate.mimeType
        },
        (uri: unknown) => {
          const resourceUri = uri instanceof URL ? uri : new URL("bun-project://findings/");
          return toMcpResourceResult(
            resourceUri.href,
            readBunProjectFindingsResource(
              { projectHash: projectFindingsHashFromUri(resourceUri) },
              {
                store: dependencies.findingCacheStore
              }
            )
          );
        }
      );
    }
  }
];

const remoteDocsToolNames = new Set(["search_bun_docs"]);
const remoteDocsResourceNames = new Set([bunDocsIndexResource.name, bunDocsPageResourceTemplate.name]);

const remoteDocsToolRegistrations = [
  searchDocsRegistration,
  ...toolRegistrations.filter((tool) => remoteDocsToolNames.has(tool.name))
];
const remoteDocsResourceRegistrations = resourceRegistrations.filter((resource) => remoteDocsResourceNames.has(resource.name));

export function createServerDependencies(options: ServerDependencyOptions = {}): ServerDependencies {
  const now = options.now ?? (() => new Date().toISOString());
  const cachePath = options.cachePath ?? defaultCachePath();
  const cache = new SqliteCacheStore(cachePath);
  const fetchClient = new SourceFetchClient({
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    now
  });
  const bunDocsIndexAdapter = new BunDocsIndexAdapter({ cache, fetchClient, now });
  const bunDocsSearchAdapter = new BunDocsSearchAdapter({ cache, fetchClient, now });
  const bunDocsPageAdapter = new BunDocsPageAdapter({
    cache,
    fetchClient,
    indexAdapter: bunDocsIndexAdapter,
    now
  });

  return {
    cache,
    findingCacheStore: new FindingCacheStore(cachePath),
    fetchClient,
    bunDocsIndexAdapter,
    bunDocsSearchAdapter,
    bunDocsPageAdapter,
    npmRegistryAdapter: new NpmRegistryAdapter({ cache, fetchClient, now }),
    projectAnalysisStore: new ProjectAnalysisStore({ now }),
    docsSourceRegistry: options.docsSourceRegistry ?? defaultDocsSourceRegistry,
    ...(options.docsRetrieval === undefined ? {} : { docsRetrieval: options.docsRetrieval }),
    docsSearchDefaults: options.docsSearchDefaults ?? { defaultLimit: 5, maxLimit: 20 },
    auditLogger: options.auditLogger ?? createAuditLogger({ env: options.env, now }),
    now
  };
}

export function createRemoteDocsServerDependencies(
  config: RemoteDocsConfig,
  options: ServerDependencyOptions = {}
): ServerDependencies {
  const sql = createPostgresClient(config.database.url);
  const embeddingProvider = createOpenAiEmbeddingProviderFromConfig(config.embeddings);
  const keywordRetrieval = new PostgresKeywordRetrieval({
    sql,
    defaultLimit: config.search.defaultLimit,
    maxLimit: config.search.maxLimit
  });
  const vectorRetrieval = new PostgresVectorRetrieval({
    sql,
    embeddingProvider,
    defaultLimit: config.search.defaultLimit,
    maxLimit: config.search.maxLimit
  });
  const storage = new RemoteDocsStorage(sql);
  const docsRetrieval = new HybridDocsRetrieval({
    keywordRetrieval,
    vectorRetrieval,
    telemetry: storage,
    defaultLimit: config.search.defaultLimit,
    maxLimit: config.search.maxLimit
  });

  return createServerDependencies({
    ...options,
    docsRetrieval,
    docsSourceRegistry: options.docsSourceRegistry ?? defaultDocsSourceRegistry,
    docsSearchDefaults: config.search
  });
}

function capabilityManifestFor(
  tools: readonly ToolRegistration[],
  resources: readonly ResourceRegistration[]
): ServerCapabilityManifest {
  return {
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema
    })),
    resources: resources.map((resource) => ({
      name: resource.name,
      description: resource.description,
      mimeType: resource.mimeType,
      ...(resource.uri === undefined ? {} : { uri: resource.uri }),
      ...(resource.uriTemplate === undefined ? {} : { uriTemplate: resource.uriTemplate })
    }))
  };
}

export function getServerCapabilityManifest(): ServerCapabilityManifest {
  return capabilityManifestFor(toolRegistrations, resourceRegistrations);
}

export function getRemoteDocsCapabilityManifest(): ServerCapabilityManifest {
  return capabilityManifestFor(remoteDocsToolRegistrations, remoteDocsResourceRegistrations);
}

function registerCapabilities(
  registrar: BunDevIntelRegistrar,
  dependencies: ServerDependencies,
  tools: readonly ToolRegistration[],
  resources: readonly ResourceRegistration[]
): void {
  for (const tool of tools) {
    registrar.registerTool(
      tool.name,
      {
        title: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema
      },
      async (input: unknown) => {
        const startedAt = performance.now();
        dependencies.auditLogger.logToolCallStart({ toolName: tool.name, input });

        try {
          const result = await tool.handler(input, dependencies);
          dependencies.auditLogger.logToolCallEnd({
            toolName: tool.name,
            input,
            status: "ok",
            durationMs: performance.now() - startedAt,
            result
          });
          return toMcpToolResult(result);
        } catch (error) {
          dependencies.auditLogger.logToolCallEnd({
            toolName: tool.name,
            input,
            status: "error",
            durationMs: performance.now() - startedAt,
            error
          });
          throw error;
        }
      }
    );
  }

  for (const resource of resources) {
    resource.register(registrar, dependencies);
  }
}

export function registerBunDevIntelCapabilities(
  registrar: BunDevIntelRegistrar,
  dependencies: ServerDependencies
): void {
  registerCapabilities(registrar, dependencies, toolRegistrations, resourceRegistrations);
}

export function registerRemoteDocsCapabilities(
  registrar: BunDevIntelRegistrar,
  dependencies: ServerDependencies
): void {
  registerCapabilities(registrar, dependencies, remoteDocsToolRegistrations, remoteDocsResourceRegistrations);
}

export interface CreateBunDevIntelServerOptions {
  readonly dependencies?: ServerDependencies;
}

export function createBunDevIntelServer(options: CreateBunDevIntelServerOptions = {}): McpServer {
  const server = new McpServer(serverMetadata);
  registerBunDevIntelCapabilities(server as unknown as BunDevIntelRegistrar, options.dependencies ?? createServerDependencies());
  return server;
}

export function createRemoteDocsMcpServer(options: CreateBunDevIntelServerOptions = {}): McpServer {
  const server = new McpServer(serverMetadata);
  registerRemoteDocsCapabilities(server as unknown as BunDevIntelRegistrar, options.dependencies ?? createServerDependencies());
  return server;
}
