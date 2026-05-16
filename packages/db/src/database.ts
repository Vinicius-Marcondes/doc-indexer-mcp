import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";

export interface SqlClient {
  <T extends readonly Record<string, unknown>[] = Record<string, unknown>[]>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T>;
  readonly unsafe: <T extends readonly Record<string, unknown>[] = Record<string, unknown>[]>(
    query: string,
    values?: readonly unknown[]
  ) => Promise<T>;
  readonly begin: <T>(callback: (sql: SqlClient) => Promise<T>) => Promise<T>;
  readonly reserve?: () => Promise<ReservedSqlClient>;
  readonly end?: (options?: { timeout?: number }) => Promise<void>;
}

export interface ReservedSqlClient extends SqlClient {
  readonly release: () => Promise<void> | void;
}

export interface RemoteDocsMigration {
  readonly id: string;
  readonly sql: string;
}

export interface RemoteDocsMigrationLogger {
  readonly debug?: (message: string, context?: Record<string, unknown>) => void;
  readonly info?: (message: string, context?: Record<string, unknown>) => void;
  readonly error?: (message: string, context?: Record<string, unknown>) => void;
}

export interface RemoteDocsMigrationOptions {
  readonly logger?: RemoteDocsMigrationLogger;
}

export interface DatabaseReadinessSuccess {
  readonly ok: true;
  readonly details: {
    readonly database: "ready";
  };
}

export interface DatabaseReadinessFailure {
  readonly ok: false;
  readonly message: string;
}

export function createPostgresClient(databaseUrl: string): SqlClient {
  return postgres(databaseUrl, { max: 5 }) as unknown as SqlClient;
}

const SCHEMA_MIGRATIONS_FILENAME = "0004_schema_migrations_table.sql";

// Serializes startup migrations across the MCP server, docs worker, and admin server.
const MIGRATION_ADVISORY_LOCK_KEY = 727073091n;

const consoleMigrationLogger: Required<RemoteDocsMigrationLogger> = {
  debug: (message, context) => {
    console.debug(formatMigrationLog("debug", message, context));
  },
  info: (message, context) => {
    console.info(formatMigrationLog("info", message, context));
  },
  error: (message, context) => {
    console.error(formatMigrationLog("error", message, context));
  }
};

export function loadRemoteDocsMigrations(rootDir = resolve(import.meta.dir, "../../..")): RemoteDocsMigration[] {
  const migrationsDir = resolve(rootDir, "migrations", "remote-docs");

  return readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => ({
      id: file,
      sql: readFileSync(resolve(migrationsDir, file), "utf8")
    }));
}

export async function runRemoteDocsMigrations(sql: SqlClient, rootDir?: string, options: RemoteDocsMigrationOptions = {}): Promise<void> {
  const logger = options.logger ?? consoleMigrationLogger;
  const migrations = loadRemoteDocsMigrations(rootDir);
  const bootstrapIndex = migrations.findIndex((migration) => migration.id === SCHEMA_MIGRATIONS_FILENAME);
  const bootstrapMigration = migrations[bootstrapIndex];

  if (bootstrapMigration === undefined) {
    throw new Error(`Missing required remote docs migration: ${SCHEMA_MIGRATIONS_FILENAME}`);
  }

  logger.info?.("remote_docs.migrations.start", {
    total: migrations.length
  });

  await withMigrationConnection(sql, async (migrationSql) => {
    await runRemoteDocsMigrationsOnConnection(migrationSql, migrations, bootstrapMigration, bootstrapIndex, logger);
  });
}

async function withMigrationConnection(sql: SqlClient, callback: (sql: SqlClient) => Promise<void>): Promise<void> {
  const reserve = sql.reserve;

  if (reserve === undefined) {
    await callback(sql);
    return;
  }

  const reserved = await reserve.call(sql);

  try {
    await callback(reserved);
  } finally {
    await reserved.release();
  }
}

async function runRemoteDocsMigrationsOnConnection(
  sql: SqlClient,
  migrations: RemoteDocsMigration[],
  bootstrapMigration: RemoteDocsMigration,
  bootstrapIndex: number,
  logger: RemoteDocsMigrationLogger
): Promise<void> {
  let migrationError: unknown;
  let lockAcquired = false;

  try {
    await acquireMigrationLock(sql);
    lockAcquired = true;

    let appliedCount = 0;
    let upToDateCount = 0;

    if (await bootstrapSchemaMigrations(sql, bootstrapMigration)) {
      appliedCount += 1;
      logger.info?.("remote_docs.migrations.applied", {
        filename: bootstrapMigration.id,
        ordinal: bootstrapIndex + 1,
        total: migrations.length
      });
    } else {
      upToDateCount += 1;
      logger.debug?.("remote_docs.migrations.skipped", {
        filename: bootstrapMigration.id,
        reason: "already_applied"
      });
    }

    const appliedMigrations = await loadAppliedMigrationFilenames(sql);

    for (const [index, migration] of migrations.entries()) {
      if (migration.id === SCHEMA_MIGRATIONS_FILENAME) {
        continue;
      }

      if (appliedMigrations.has(migration.id)) {
        upToDateCount += 1;
        logger.debug?.("remote_docs.migrations.skipped", {
          filename: migration.id,
          reason: "already_applied"
        });
        continue;
      }

      await applyRemoteDocsMigration(sql, migration, index + 1, migrations.length, logger);
      appliedMigrations.add(migration.id);
      appliedCount += 1;
    }

    logger.info?.("remote_docs.migrations.complete", {
      applied: appliedCount,
      upToDate: upToDateCount,
      summary: `${appliedCount} migrations applied, ${upToDateCount} already up to date`
    });
  } catch (error) {
    migrationError = error;
    throw error;
  } finally {
    if (lockAcquired) {
      try {
        await releaseMigrationLock(sql);
      } catch (error) {
        logger.error?.("remote_docs.migrations.unlock_failed", normalizeMigrationError(error));

        if (migrationError === undefined) {
          throw error;
        }
      }
    }
  }
}

async function acquireMigrationLock(sql: SqlClient): Promise<void> {
  await sql`SELECT pg_advisory_lock(${MIGRATION_ADVISORY_LOCK_KEY.toString()}::bigint)`;
}

async function releaseMigrationLock(sql: SqlClient): Promise<void> {
  await sql`SELECT pg_advisory_unlock(${MIGRATION_ADVISORY_LOCK_KEY.toString()}::bigint)`;
}

async function bootstrapSchemaMigrations(sql: SqlClient, migration: RemoteDocsMigration): Promise<boolean> {
  const rows = await sql.begin<{ filename: string }[]>(async (tx) => {
    await tx.unsafe(migration.sql);
    return recordAppliedMigration(tx, migration.id);
  });

  return rows.length > 0;
}

async function loadAppliedMigrationFilenames(sql: SqlClient): Promise<Set<string>> {
  const rows = await sql<{ filename: string }[]>`
    SELECT filename
    FROM schema_migrations
  `;

  return new Set(rows.map((row) => row.filename));
}

async function applyRemoteDocsMigration(
  sql: SqlClient,
  migration: RemoteDocsMigration,
  ordinal: number,
  total: number,
  logger: RemoteDocsMigrationLogger
): Promise<void> {
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe(migration.sql);
      await recordAppliedMigration(tx, migration.id);
    });
    logger.info?.("remote_docs.migrations.applied", {
      filename: migration.id,
      ordinal,
      total
    });
  } catch (error) {
    logger.error?.("remote_docs.migrations.failed", {
      filename: migration.id,
      ordinal,
      total,
      ...normalizeMigrationError(error)
    });
    throw error;
  }
}

async function recordAppliedMigration(sql: SqlClient, filename: string): Promise<{ filename: string }[]> {
  return sql<{ filename: string }[]>`
    INSERT INTO schema_migrations (filename)
    VALUES (${filename})
    ON CONFLICT (filename) DO NOTHING
    RETURNING filename
  `;
}

function normalizeMigrationError(error: unknown): Record<string, unknown> {
  const maybePostgresError = error as { readonly code?: unknown; readonly message?: unknown };

  return {
    code: typeof maybePostgresError.code === "string" ? maybePostgresError.code : undefined,
    message:
      typeof maybePostgresError.message === "string"
        ? maybePostgresError.message
        : error instanceof Error
          ? error.message
          : String(error)
  };
}

function formatMigrationLog(level: string, message: string, context?: Record<string, unknown>): string {
  return JSON.stringify({
    level,
    event: message,
    ...(context ?? {})
  });
}

export function createDatabaseReadinessCheck(sql: SqlClient): () => Promise<DatabaseReadinessSuccess | DatabaseReadinessFailure> {
  return async () => {
    try {
      await sql`select 1 as ready`;
      return {
        ok: true,
        details: {
          database: "ready"
        }
      };
    } catch {
      return {
        ok: false,
        message: "Database is not ready."
      };
    }
  };
}
