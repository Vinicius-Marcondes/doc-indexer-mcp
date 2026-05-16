import { createPostgresClient, runRemoteDocsMigrations } from "../packages/db/src/index.ts";

export async function runRemoteDocsMigrationCli(env: Record<string, string | undefined> = Bun.env): Promise<void> {
  const databaseUrl = env.DATABASE_URL?.trim();

  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new Error("DATABASE_URL is required to run remote docs migrations.");
  }

  const sql = createPostgresClient(databaseUrl);

  try {
    await runRemoteDocsMigrations(sql);
  } finally {
    await sql.end?.({ timeout: 1 });
  }
}

if (import.meta.main) {
  await runRemoteDocsMigrationCli();
}
