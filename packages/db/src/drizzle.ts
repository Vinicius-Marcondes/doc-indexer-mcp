import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { SqlClient } from "./database";
import { remoteDocsDrizzleSchema } from "./schema";

export type RemoteDocsDrizzleDatabase = PostgresJsDatabase<typeof remoteDocsDrizzleSchema>;

export function createDrizzleDatabase(sql: SqlClient): RemoteDocsDrizzleDatabase {
  return drizzle(sql as never, { schema: remoteDocsDrizzleSchema });
}
