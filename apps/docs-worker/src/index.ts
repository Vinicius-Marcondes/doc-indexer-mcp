import { parseRemoteDocsConfig, type RemoteDocsConfig, type RemoteDocsConfigIssue } from "../../../src/config/remote-docs-config";
import { createPostgresClient, RemoteDocsStorage, type SqlClient } from "@bun-dev-intel/db";
import { createOpenAiEmbeddingProviderFromConfig } from "@bun-dev-intel/docs-domain/docs/embeddings/openai-provider";
import { BunDocsIngestionPipeline } from "@bun-dev-intel/docs-domain/docs/ingestion/ingestion-pipeline";
import { RefreshJobQueue } from "@bun-dev-intel/docs-domain/docs/refresh/refresh-queue";
import {
  BunDocsRefreshJobExecutor,
  DocsRefreshWorker,
  type DocsRefreshWorkerCycleResult,
  type DocsRefreshWorkerLogger
} from "@bun-dev-intel/docs-domain/docs/refresh/docs-worker";
import { BunDocsDiscoveryClient, type DocsSourceFetchLike } from "@bun-dev-intel/docs-domain/docs/sources/bun-docs-discovery";
import { defaultDocsSourceRegistry } from "@bun-dev-intel/docs-domain/docs/sources/bun-source-pack";
import type { DocsSourceRegistry } from "@bun-dev-intel/docs-domain/docs/sources/registry";

export interface RunDocsWorkerOnceOptions {
  readonly env?: Record<string, string | undefined>;
  readonly fetchImpl?: DocsSourceFetchLike;
  readonly sql?: SqlClient;
  readonly worker?: DocsRefreshWorker;
}

export interface DocsWorkerStartupSuccess {
  readonly ok: true;
  readonly result: DocsRefreshWorkerCycleResult;
}

export interface DocsWorkerStartupFailure {
  readonly ok: false;
  readonly error: {
    readonly code: "startup_failed";
    readonly message: string;
    readonly issues?: readonly RemoteDocsConfigIssue[];
  };
}

export type DocsWorkerStartupResult = DocsWorkerStartupSuccess | DocsWorkerStartupFailure;

function queueLimitFromConfig(input: { readonly maxPagesPerRun: number; readonly maxEmbeddingsPerRun: number }): number {
  return Math.max(input.maxPagesPerRun + input.maxEmbeddingsPerRun, 100);
}

export interface DocsSourceSeedStore {
  readonly upsertSource: (input: {
    readonly sourceId: string;
    readonly displayName: string;
    readonly enabled: boolean;
    readonly allowedUrlPatterns: readonly string[];
    readonly defaultTtlSeconds: number;
  }) => Promise<unknown>;
}

export async function seedConfiguredDocsSources(
  store: DocsSourceSeedStore,
  sourceRegistry: DocsSourceRegistry = defaultDocsSourceRegistry
): Promise<void> {
  for (const source of sourceRegistry.list()) {
    await store.upsertSource({
      sourceId: source.sourceId,
      displayName: source.displayName,
      enabled: source.enabled,
      allowedUrlPatterns: source.allowedUrlPatterns,
      defaultTtlSeconds: source.refreshPolicy.defaultTtlSeconds
    });
  }
}

export function createDocsRefreshWorker(input: {
  readonly config: RemoteDocsConfig;
  readonly sql: SqlClient;
  readonly fetchImpl?: DocsSourceFetchLike;
  readonly logger?: DocsRefreshWorkerLogger;
}): DocsRefreshWorker {
  const storage = new RemoteDocsStorage(input.sql);
  const embeddingProvider = createOpenAiEmbeddingProviderFromConfig(input.config.embeddings);
  const pipeline = new BunDocsIngestionPipeline({
    storage,
    discoveryClient: new BunDocsDiscoveryClient({
      ...(input.fetchImpl === undefined ? {} : { fetchImpl: input.fetchImpl })
    }),
    embeddingProvider
  });
  const maxPendingJobs = queueLimitFromConfig(input.config.refresh);
  const queue = new RefreshJobQueue({
    store: storage,
    sourceRegistry: defaultDocsSourceRegistry,
    now: () => new Date().toISOString(),
    maxPendingJobs,
    maxPendingJobsPerSource: maxPendingJobs
  });

  return new DocsRefreshWorker({
    store: storage,
    queue,
    executor: new BunDocsRefreshJobExecutor({ pipeline }),
    sourceRegistry: defaultDocsSourceRegistry,
    logger: input.logger ?? stderrDocsWorkerLogger,
    now: () => new Date().toISOString(),
    refreshIntervalSeconds: input.config.refresh.interval.seconds,
    maxJobsPerRun: input.config.refresh.maxPagesPerRun + input.config.refresh.maxEmbeddingsPerRun,
    maxPagesPerRun: input.config.refresh.maxPagesPerRun,
    maxEmbeddingsPerRun: input.config.refresh.maxEmbeddingsPerRun,
    maxConcurrency: input.config.refresh.maxConcurrency,
    runningJobTimeoutSeconds: input.config.refresh.runningTimeoutSeconds
  });
}

const stderrDocsWorkerLogger: DocsRefreshWorkerLogger = {
  info: (message) => process.stderr.write(`${message}\n`),
  error: (message) => process.stderr.write(`${message}\n`)
};

export async function runDocsWorkerOnce(options: RunDocsWorkerOnceOptions = {}): Promise<DocsWorkerStartupResult> {
  if (options.worker !== undefined) {
    return {
      ok: true,
      result: await options.worker.runCycle()
    };
  }

  const configResult = parseRemoteDocsConfig(options.env ?? Bun.env);

  if (!configResult.ok) {
    return {
      ok: false,
      error: {
        code: "startup_failed",
        message: configResult.error.message,
        issues: configResult.error.issues
      }
    };
  }

  const sql = options.sql ?? createPostgresClient(configResult.config.database.url);

  try {
    await seedConfiguredDocsSources(new RemoteDocsStorage(sql));
    const worker = createDocsRefreshWorker({
      config: configResult.config,
      sql,
      ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl })
    });
    const result = await worker.runCycle();

    return {
      ok: true,
      result
    };
  } catch {
    return {
      ok: false,
      error: {
        code: "startup_failed",
        message: "Docs worker failed to run."
      }
    };
  } finally {
    if (options.sql === undefined) {
      await sql.end?.({ timeout: 1 });
    }
  }
}

export function startDocsWorker(options: RunDocsWorkerOnceOptions = {}): Promise<DocsWorkerStartupResult> {
  return runDocsWorkerOnce(options);
}

if (import.meta.main) {
  const result = await startDocsWorker();

  if (!result.ok) {
    process.stderr.write(`bun-dev-intel-mcp docs worker failed: ${result.error.message}\n`);
    process.exit(1);
  }

  process.stderr.write(
    `bun-dev-intel-mcp docs worker processed ${result.result.processed} refresh jobs ` +
      `(${result.result.succeeded} succeeded, ${result.result.failed} failed)\n`
  );
}
