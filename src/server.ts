import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { SqliteCacheStore } from "./cache/sqlite-cache";
import { createAuditLogger, type AuditLogEnv, type AuditLogger } from "./logging/audit-logger";
import { getDocPage, getDocPageInputSchema } from "./tools/get-doc-page";
import { searchBunDocs, searchBunDocsInputSchema } from "./tools/search-bun-docs";
import { searchDocs, searchDocsInputSchema, type SearchDocsRefreshQueue, type SearchDocsRetrieval } from "./tools/search-docs";
import { SourceFetchClient, type FetchLike } from "./sources/fetch-client";
import { BunDocsIndexAdapter } from "./sources/bun-docs-index";
import { BunDocsPageAdapter } from "./sources/bun-docs-page";
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
  DOCS_CHUNK_RESOURCE_URI_TEMPLATE,
  DOCS_PAGE_RESOURCE_URI_TEMPLATE,
  DOCS_SOURCES_RESOURCE_URI,
  docsChunkResourceTemplate,
  docsPageResourceTemplate,
  docsSourcesResource,
  readDocsChunkResource,
  readDocsPageResource,
  readDocsSourcesResource,
  type DocsPageStore
} from "./resources/docs-resources";
import type { RemoteDocsConfig } from "./config/remote-docs-config";
import { createOpenAiEmbeddingProviderFromConfig } from "./docs/embeddings/openai-provider";
import { RefreshJobQueue } from "./docs/refresh/refresh-queue";
import { HybridDocsRetrieval } from "./docs/retrieval/hybrid-retrieval";
import { PostgresKeywordRetrieval } from "./docs/retrieval/keyword-retrieval";
import { PostgresVectorRetrieval } from "./docs/retrieval/vector-retrieval";
import { defaultDocsSourceRegistry } from "./docs/sources/bun-source-pack";
import type { DocsSourceRegistry } from "./docs/sources/registry";
import { createPostgresClient } from "./docs/storage/database";
import { RemoteDocsStorage } from "./docs/storage/docs-storage";

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
  readonly fetchClient: SourceFetchClient;
  readonly bunDocsIndexAdapter: BunDocsIndexAdapter;
  readonly bunDocsPageAdapter: BunDocsPageAdapter;
  readonly docsSourceRegistry: DocsSourceRegistry;
  readonly docsRetrieval?: SearchDocsRetrieval;
  readonly docsPageStore?: DocsPageStore;
  readonly docsRefreshQueue?: SearchDocsRefreshQueue;
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
  readonly docsPageStore?: DocsPageStore;
  readonly docsRefreshQueue?: SearchDocsRefreshQueue;
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

const searchDocsRegistration: ToolRegistration = {
  name: "search_docs",
  description: "Search indexed official docs with hybrid keyword and semantic retrieval; remote docs only.",
  inputSchema: searchDocsInputSchema,
  handler: (input, dependencies) =>
    searchDocs(input, {
      retrieval: dependencies.docsRetrieval,
      sourceRegistry: dependencies.docsSourceRegistry,
      refreshQueue: dependencies.docsRefreshQueue,
      now: dependencies.now,
      defaultLimit: dependencies.docsSearchDefaults.defaultLimit,
      maxLimit: dependencies.docsSearchDefaults.maxLimit
    })
};

const getDocPageRegistration: ToolRegistration = {
  name: "get_doc_page",
  description: "Read one stored allowlisted documentation page and its indexed chunks; remote docs only.",
  inputSchema: getDocPageInputSchema,
  handler: (input, dependencies) =>
    getDocPage(input, {
      pageStore: dependencies.docsPageStore,
      refreshQueue: dependencies.docsRefreshQueue,
      sourceRegistry: dependencies.docsSourceRegistry,
      now: dependencies.now
    })
};

const searchBunDocsRegistration: ToolRegistration = {
  name: "search_bun_docs",
  description: "Compatibility wrapper for official Bun documentation search over remote docs retrieval.",
  inputSchema: searchBunDocsInputSchema,
  handler: (input, dependencies) =>
    searchBunDocs(input, {
      retrieval: dependencies.docsRetrieval,
      sourceRegistry: dependencies.docsSourceRegistry,
      refreshQueue: dependencies.docsRefreshQueue,
      now: dependencies.now,
      defaultLimit: dependencies.docsSearchDefaults.defaultLimit,
      maxLimit: dependencies.docsSearchDefaults.maxLimit
    })
};

const remoteDocsToolRegistrations = [searchDocsRegistration, getDocPageRegistration, searchBunDocsRegistration];

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

function docsResourceParamsFromUri(uri: URL): { readonly sourceId: string; readonly id: string } {
  const [sourceId = "", id = ""] = uri.pathname
    .split("/")
    .filter((part) => part.length > 0)
    .map((part) => decodeURIComponent(part));

  return { sourceId, id };
}

const remoteDocsResourceRegistrations: ResourceRegistration[] = [
  {
    name: docsSourcesResource.name,
    description: docsSourcesResource.description,
    mimeType: docsSourcesResource.mimeType,
    uri: docsSourcesResource.uri,
    register: (registrar, dependencies) => {
      registrar.registerResource(
        docsSourcesResource.name,
        DOCS_SOURCES_RESOURCE_URI,
        {
          title: "Docs sources",
          description: docsSourcesResource.description,
          mimeType: docsSourcesResource.mimeType
        },
        async (uri: unknown) =>
          toMcpResourceResult(
            uri instanceof URL ? uri.href : DOCS_SOURCES_RESOURCE_URI,
            await readDocsSourcesResource({
              pageStore: dependencies.docsPageStore,
              sourceRegistry: dependencies.docsSourceRegistry,
              now: dependencies.now
            })
          )
      );
    }
  },
  {
    name: docsPageResourceTemplate.name,
    description: docsPageResourceTemplate.description,
    mimeType: docsPageResourceTemplate.mimeType,
    uriTemplate: docsPageResourceTemplate.uriTemplate,
    register: (registrar, dependencies) => {
      registrar.registerResource(
        docsPageResourceTemplate.name,
        new ResourceTemplate(DOCS_PAGE_RESOURCE_URI_TEMPLATE, { list: undefined }),
        {
          title: "Docs page",
          description: docsPageResourceTemplate.description,
          mimeType: docsPageResourceTemplate.mimeType
        },
        async (uri: unknown) => {
          const resourceUri = uri instanceof URL ? uri : new URL("docs://page/");
          const params = docsResourceParamsFromUri(resourceUri);

          return toMcpResourceResult(
            resourceUri.href,
            await readDocsPageResource(
              { sourceId: params.sourceId, pageId: params.id },
              {
                pageStore: dependencies.docsPageStore,
                sourceRegistry: dependencies.docsSourceRegistry,
                now: dependencies.now
              }
            )
          );
        }
      );
    }
  },
  {
    name: docsChunkResourceTemplate.name,
    description: docsChunkResourceTemplate.description,
    mimeType: docsChunkResourceTemplate.mimeType,
    uriTemplate: docsChunkResourceTemplate.uriTemplate,
    register: (registrar, dependencies) => {
      registrar.registerResource(
        docsChunkResourceTemplate.name,
        new ResourceTemplate(DOCS_CHUNK_RESOURCE_URI_TEMPLATE, { list: undefined }),
        {
          title: "Docs chunk",
          description: docsChunkResourceTemplate.description,
          mimeType: docsChunkResourceTemplate.mimeType
        },
        async (uri: unknown) => {
          const resourceUri = uri instanceof URL ? uri : new URL("docs://chunk/");
          const params = docsResourceParamsFromUri(resourceUri);

          return toMcpResourceResult(
            resourceUri.href,
            await readDocsChunkResource(
              { sourceId: params.sourceId, chunkId: params.id },
              {
                pageStore: dependencies.docsPageStore,
                sourceRegistry: dependencies.docsSourceRegistry,
                now: dependencies.now
              }
            )
          );
        }
      );
    }
  },
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
  }
];

export function createServerDependencies(options: ServerDependencyOptions = {}): ServerDependencies {
  const now = options.now ?? (() => new Date().toISOString());
  const cachePath = options.cachePath ?? defaultCachePath();
  const cache = new SqliteCacheStore(cachePath);
  const fetchClient = new SourceFetchClient({
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    now
  });
  const bunDocsIndexAdapter = new BunDocsIndexAdapter({ cache, fetchClient, now });

  return {
    cache,
    fetchClient,
    bunDocsIndexAdapter,
    bunDocsPageAdapter: new BunDocsPageAdapter({
      cache,
      fetchClient,
      indexAdapter: bunDocsIndexAdapter,
      now
    }),
    docsSourceRegistry: options.docsSourceRegistry ?? defaultDocsSourceRegistry,
    ...(options.docsRetrieval === undefined ? {} : { docsRetrieval: options.docsRetrieval }),
    ...(options.docsPageStore === undefined ? {} : { docsPageStore: options.docsPageStore }),
    ...(options.docsRefreshQueue === undefined ? {} : { docsRefreshQueue: options.docsRefreshQueue }),
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
  const docsRefreshQueue = new RefreshJobQueue({
    store: storage,
    sourceRegistry: options.docsSourceRegistry ?? defaultDocsSourceRegistry,
    now: options.now ?? (() => new Date().toISOString()),
    maxPendingJobs: Math.max(config.refresh.maxPagesPerRun + config.refresh.maxEmbeddingsPerRun, 100),
    maxPendingJobsPerSource: Math.max(config.refresh.maxPagesPerRun, 100)
  });
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
    docsPageStore: storage,
    docsRefreshQueue,
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

export function registerRemoteDocsCapabilities(
  registrar: BunDevIntelRegistrar,
  dependencies: ServerDependencies
): void {
  registerCapabilities(registrar, dependencies, remoteDocsToolRegistrations, remoteDocsResourceRegistrations);
}

export interface CreateRemoteDocsMcpServerOptions {
  readonly dependencies?: ServerDependencies;
}

export function createRemoteDocsMcpServer(options: CreateRemoteDocsMcpServerOptions = {}): McpServer {
  const server = new McpServer(serverMetadata);
  registerRemoteDocsCapabilities(server as unknown as BunDevIntelRegistrar, options.dependencies ?? createServerDependencies());
  return server;
}
