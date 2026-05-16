import { createPostgresClient, runRemoteDocsMigrations, type SqlClient } from "../../../packages/db/src";

export interface RemoteDocsTestDatabase {
  readonly sql: SqlClient;
  readonly schemaName: string;
  readonly cleanup: () => Promise<void>;
}

export async function createRemoteDocsTestDatabase(): Promise<RemoteDocsTestDatabase | null> {
  const databaseUrl = process.env.TEST_DATABASE_URL;

  if (databaseUrl === undefined || databaseUrl.trim().length === 0) {
    return null;
  }

  const sql = createPostgresClient(databaseUrl);
  const schemaName = `remote_docs_storage_${crypto.randomUUID().replaceAll("-", "_")}`;
  let cleanedUp = false;

  await sql.unsafe(`create schema ${schemaName}`);
  await sql.unsafe(`set search_path to ${schemaName}, public`);
  await runRemoteDocsMigrations(sql);

  return {
    sql,
    schemaName,
    cleanup: async () => {
      if (cleanedUp) {
        return;
      }

      cleanedUp = true;
      await sql.unsafe(`drop schema if exists ${schemaName} cascade`);
      await sql.end?.({ timeout: 1 });
    }
  };
}
