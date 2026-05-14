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
  readonly end?: (options?: { timeout?: number }) => Promise<void>;
}

export interface RemoteDocsMigration {
  readonly id: string;
  readonly sql: string;
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

export async function runRemoteDocsMigrations(sql: SqlClient, rootDir?: string): Promise<void> {
  for (const migration of loadRemoteDocsMigrations(rootDir)) {
    await sql.unsafe(migration.sql);
  }
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
