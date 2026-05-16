import { afterEach, describe, expect, test } from "bun:test";
import {
  AdminAuthStorage,
  bootstrapFirstAdminUser,
  createAdminSession,
  hashSessionToken,
  verifyAdminPassword
} from "../../../apps/admin-console/server/src/auth";
import {
  createRemoteDocsTestDatabase,
  type RemoteDocsTestDatabase
} from "../storage/test-harness";

const postgresTest = process.env.TEST_DATABASE_URL === undefined ? test.skip : test;
let database: RemoteDocsTestDatabase | null = null;

afterEach(async () => {
  await database?.cleanup();
  database = null;
});

describe("admin auth storage", () => {
  postgresTest("bootstrap creates first admin only once", async () => {
    database = await createRemoteDocsTestDatabase();

    if (database === null) {
      throw new Error("Expected TEST_DATABASE_URL database.");
    }

    const storage = new AdminAuthStorage(database.sql);
    const first = await bootstrapFirstAdminUser({
      storage,
      env: {
        ADMIN_BOOTSTRAP_EMAIL: "Admin@Example.com",
        ADMIN_BOOTSTRAP_PASSWORD: "correct horse battery staple"
      },
      now: () => "2026-05-14T12:00:00.000Z"
    });
    const second = await bootstrapFirstAdminUser({
      storage,
      env: {
        ADMIN_BOOTSTRAP_EMAIL: "other@example.com",
        ADMIN_BOOTSTRAP_PASSWORD: "another-password"
      },
      now: () => "2026-05-14T12:01:00.000Z"
    });
    const user = await storage.getUserByEmail("admin@example.com");

    expect(first.status).toBe("created");
    expect(second.status).toBe("skipped_existing_user");
    expect(user?.role).toBe("admin");
    expect(user?.passwordHash).not.toBe("correct horse battery staple");
    expect(await verifyAdminPassword("correct horse battery staple", user?.passwordHash ?? "")).toBe(true);
  });

  postgresTest("session lookup works by token hash without storing raw tokens", async () => {
    database = await createRemoteDocsTestDatabase();

    if (database === null) {
      throw new Error("Expected TEST_DATABASE_URL database.");
    }

    const storage = new AdminAuthStorage(database.sql);
    const user = await storage.createUser({
      email: "viewer@example.com",
      passwordHash: "hashed-password",
      role: "viewer",
      now: "2026-05-14T12:00:00.000Z"
    });
    const created = await createAdminSession({
      store: storage,
      userId: user.id,
      now: () => "2026-05-14T12:00:00.000Z",
      ttlSeconds: 3600,
      userAgent: "test-agent",
      ip: "127.0.0.1"
    });
    const tokenHash = hashSessionToken(created.token);
    const session = await storage.getSessionByTokenHash(tokenHash, "2026-05-14T12:05:00.000Z");
    const rawTokenRows = await database.sql<Array<{ count: number }>>`
      select count(*)::integer as count
      from admin_sessions
      where session_token_hash = ${created.token}
    `;

    expect(session?.email).toBe("viewer@example.com");
    expect(session?.role).toBe("viewer");
    expect(Number(rawTokenRows[0]?.count ?? 0)).toBe(0);
    expect(await storage.revokeSession(tokenHash, "2026-05-14T12:06:00.000Z")).toBe(true);
    expect(await storage.getSessionByTokenHash(tokenHash, "2026-05-14T12:07:00.000Z")).toBeNull();
  });
});
