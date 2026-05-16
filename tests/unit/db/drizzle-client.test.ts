import { describe, expect, test } from "bun:test";
import { getTableName } from "drizzle-orm";
import {
  createDrizzleDatabase,
  docSources,
  remoteDocsDrizzleSchema,
  type SqlClient
} from "../../../packages/db/src";

describe("Drizzle database client", () => {
  test("wraps the existing postgres.js client without replacing raw SQL access", () => {
    const sql = Object.assign(
      async () => [],
      {
        options: { parsers: {}, serializers: {} },
        unsafe: async () => [],
        begin: async <T>(callback: (transaction: SqlClient) => Promise<T>) => callback(sql as SqlClient)
      }
    ) as unknown as SqlClient;

    const db = createDrizzleDatabase(sql);

    expect(typeof db.select).toBe("function");
    expect(getTableName(remoteDocsDrizzleSchema.docSources)).toBe("doc_sources");
    expect(remoteDocsDrizzleSchema.docSources).toBe(docSources);
  });
});
