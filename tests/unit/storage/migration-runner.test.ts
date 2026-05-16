import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { runRemoteDocsMigrations, type RemoteDocsMigrationLogger, type SqlClient } from "../../../packages/db/src/database";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("remote docs migration runner", () => {
  test("records fresh migrations and skips tracked migrations on the next run", async () => {
    const rootDir = createMigrationRoot({
      "0001_first.sql": "-- first migration",
      "0002_second.sql": "-- second migration",
      "0004_schema_migrations_table.sql": "CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY);"
    });
    const mock = createMockSqlClient();
    const logs = createCapturedLogger();

    await runRemoteDocsMigrations(mock.sql, rootDir, { logger: logs.logger });

    expect(mock.appliedFilenames()).toEqual(["0001_first.sql", "0002_second.sql", "0004_schema_migrations_table.sql"]);
    expect(mock.userMigrationBodies()).toEqual(["-- first migration", "-- second migration"]);
    expect(mock.lockBalance()).toBe(0);
    expect(logs.infoContexts("remote_docs.migrations.complete").at(-1)).toMatchObject({
      applied: 3,
      upToDate: 0,
      summary: "3 migrations applied, 0 already up to date"
    });

    mock.clearUnsafeCalls();

    await runRemoteDocsMigrations(mock.sql, rootDir, { logger: logs.logger });

    expect(mock.appliedFilenames()).toEqual(["0001_first.sql", "0002_second.sql", "0004_schema_migrations_table.sql"]);
    expect(mock.userMigrationBodies()).toEqual([]);
    expect(mock.lockBalance()).toBe(0);
    expect(logs.infoContexts("remote_docs.migrations.complete").at(-1)).toMatchObject({
      applied: 0,
      upToDate: 3,
      summary: "0 migrations applied, 3 already up to date"
    });
  });

  test("backfills tracking rows when the database was migrated by the old runner", async () => {
    const rootDir = createMigrationRoot({
      "0001_remote_docs_schema.sql": "-- idempotent old migration 1",
      "0002_admin_auth_schema.sql": "-- idempotent old migration 2",
      "0003_admin_audit_events.sql": "-- idempotent old migration 3",
      "0004_schema_migrations_table.sql": "CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY);"
    });
    const mock = createMockSqlClient();

    await runRemoteDocsMigrations(mock.sql, rootDir, { logger: createCapturedLogger().logger });

    expect(mock.appliedFilenames()).toEqual([
      "0001_remote_docs_schema.sql",
      "0002_admin_auth_schema.sql",
      "0003_admin_audit_events.sql",
      "0004_schema_migrations_table.sql"
    ]);
    expect(mock.userMigrationBodies()).toEqual([
      "-- idempotent old migration 1",
      "-- idempotent old migration 2",
      "-- idempotent old migration 3"
    ]);
  });

  test("rolls back the tracking row when a migration body fails", async () => {
    const rootDir = createMigrationRoot({
      "0001_first.sql": "-- first migration",
      "0002_bad.sql": "-- bad migration",
      "0004_schema_migrations_table.sql": "CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY);"
    });
    const mock = createMockSqlClient({ failOnSql: "-- bad migration" });
    const logs = createCapturedLogger();

    await expect(runRemoteDocsMigrations(mock.sql, rootDir, { logger: logs.logger })).rejects.toThrow("migration failed");

    expect(mock.appliedFilenames()).toEqual(["0001_first.sql", "0004_schema_migrations_table.sql"]);
    expect(mock.userMigrationBodies()).toEqual(["-- first migration", "-- bad migration"]);
    expect(mock.lockBalance()).toBe(0);
    expect(logs.errorContexts("remote_docs.migrations.failed")).toEqual([
      expect.objectContaining({
        filename: "0002_bad.sql",
        code: "XX001",
        message: "migration failed"
      })
    ]);
  });

  test("reserves and releases one connection when the client supports reservation", async () => {
    const rootDir = createMigrationRoot({
      "0001_first.sql": "-- first migration",
      "0004_schema_migrations_table.sql": "CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY);"
    });
    const mock = createMockSqlClient({ reserveConnection: true });

    await runRemoteDocsMigrations(mock.sql, rootDir, { logger: createCapturedLogger().logger });

    expect(mock.reserveCalls()).toBe(1);
    expect(mock.releaseCalls()).toBe(1);
    expect(mock.lockBalance()).toBe(0);
    expect(mock.appliedFilenames()).toEqual(["0001_first.sql", "0004_schema_migrations_table.sql"]);
  });

  test("fails fast when the schema migrations bootstrap file is missing", async () => {
    const rootDir = createMigrationRoot({
      "0001_first.sql": "-- first migration"
    });
    const mock = createMockSqlClient();

    await expect(runRemoteDocsMigrations(mock.sql, rootDir, { logger: createCapturedLogger().logger })).rejects.toThrow(
      "Missing required remote docs migration: 0004_schema_migrations_table.sql"
    );
    expect(mock.lockBalance()).toBe(0);
  });
});

function createMigrationRoot(files: Record<string, string>): string {
  const rootDir = mkdtempSync(resolve(tmpdir(), "remote-docs-runner-"));
  const migrationsDir = resolve(rootDir, "migrations", "remote-docs");
  mkdirSync(migrationsDir, { recursive: true });

  for (const [filename, contents] of Object.entries(files)) {
    writeFileSync(resolve(migrationsDir, filename), contents);
  }

  tempRoots.push(rootDir);
  return rootDir;
}

interface MockSqlClientOptions {
  readonly failOnSql?: string;
  readonly reserveConnection?: boolean;
}

function createMockSqlClient(options: MockSqlClientOptions = {}): {
  readonly sql: SqlClient;
  readonly appliedFilenames: () => string[];
  readonly userMigrationBodies: () => string[];
  readonly clearUnsafeCalls: () => void;
  readonly lockBalance: () => number;
  readonly reserveCalls: () => number;
  readonly releaseCalls: () => number;
} {
  let applied = new Set<string>();
  let lockBalance = 0;
  let reserveCalls = 0;
  let releaseCalls = 0;
  let unsafeCalls: string[] = [];

  function createClient(transactionApplied?: Set<string>, isReserved = false): SqlClient {
    const query = async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const normalizedQuery = normalizeQuery(strings);
      const targetApplied = transactionApplied ?? applied;

      if (normalizedQuery.includes("pg_advisory_lock")) {
        lockBalance += 1;
        return [];
      }

      if (normalizedQuery.includes("pg_advisory_unlock")) {
        lockBalance -= 1;
        return [{ pg_advisory_unlock: true }];
      }

      if (normalizedQuery.includes("select filename") && normalizedQuery.includes("from schema_migrations")) {
        return [...targetApplied].map((filename) => ({ filename }));
      }

      if (normalizedQuery.includes("insert into schema_migrations")) {
        const filename = String(values[0]);

        if (targetApplied.has(filename)) {
          return [];
        }

        targetApplied.add(filename);
        return [{ filename }];
      }

      throw new Error(`Unexpected query: ${normalizedQuery}`);
    };

    const unsafe = async (query: string) => {
      unsafeCalls.push(query);

      if (options.failOnSql !== undefined && query.includes(options.failOnSql)) {
        const error = new Error("migration failed") as Error & { code: string };
        error.code = "XX001";
        throw error;
      }

      return [];
    };

    const begin = async <T>(callback: (tx: SqlClient) => Promise<T>) => {
      const transactionAppliedSnapshot = new Set(applied);
      const result = await callback(createClient(transactionAppliedSnapshot, isReserved));
      applied = transactionAppliedSnapshot;
      return result;
    };

    const client = Object.assign(query, { unsafe, begin });

    if (transactionApplied === undefined && !isReserved && options.reserveConnection === true) {
      return Object.assign(client, {
        reserve: async () => {
          reserveCalls += 1;
          return Object.assign(createClient(undefined, true), {
            release: () => {
              releaseCalls += 1;
            }
          });
        }
      }) as SqlClient;
    }

    if (isReserved) {
      return Object.assign(client, {
        release: () => {
          releaseCalls += 1;
        }
      }) as SqlClient;
    }

    return client as SqlClient;
  }

  return {
    sql: createClient(),
    appliedFilenames: () => [...applied].sort(),
    userMigrationBodies: () => unsafeCalls.filter((query) => !query.includes("schema_migrations")),
    clearUnsafeCalls: () => {
      unsafeCalls = [];
    },
    lockBalance: () => lockBalance,
    reserveCalls: () => reserveCalls,
    releaseCalls: () => releaseCalls
  };
}

function normalizeQuery(strings: TemplateStringsArray): string {
  return strings.join("?").replaceAll(/\s+/g, " ").trim().toLowerCase();
}

function createCapturedLogger(): {
  readonly logger: RemoteDocsMigrationLogger;
  readonly infoContexts: (message: string) => Record<string, unknown>[];
  readonly errorContexts: (message: string) => Record<string, unknown>[];
} {
  const entries: { level: "debug" | "info" | "error"; message: string; context?: Record<string, unknown> }[] = [];
  const logger: Required<RemoteDocsMigrationLogger> = {
    debug: (message, context) => entries.push({ level: "debug", message, context }),
    info: (message, context) => entries.push({ level: "info", message, context }),
    error: (message, context) => entries.push({ level: "error", message, context })
  };

  return {
    logger,
    infoContexts: (message) => entries.filter((entry) => entry.level === "info" && entry.message === message).map((entry) => entry.context ?? {}),
    errorContexts: (message) => entries.filter((entry) => entry.level === "error" && entry.message === message).map((entry) => entry.context ?? {})
  };
}
