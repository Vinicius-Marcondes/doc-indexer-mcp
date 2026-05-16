import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import {
  createAdminSession,
  createAdminAuthMiddleware,
  hashAdminPassword,
  hashSessionToken,
  InMemoryLoginRateLimiter,
  requireAdminRole,
  verifyAdminPassword,
  type AdminPrincipal,
  type AdminAuthSession,
  type AdminAuthStore
} from "../../../apps/admin-console/server/src/auth";

class MemoryAuthStore implements AdminAuthStore {
  users = new Map<number, { id: number; email: string; role: "admin" | "viewer"; disabledAt: string | null }>();
  sessions = new Map<string, AdminAuthSession>();

  async getUserById(id: number) {
    return this.users.get(id) ?? null;
  }

  async createSession(input: {
    readonly userId: number;
    readonly sessionTokenHash: string;
    readonly expiresAt: string;
    readonly userAgentHash?: string;
    readonly ipHash?: string;
    readonly now: string;
  }): Promise<AdminAuthSession> {
    const user = this.users.get(input.userId);

    if (user === undefined || user.disabledAt !== null) {
      throw new Error("Cannot create a session for a disabled or missing user.");
    }

    const session: AdminAuthSession = {
      id: this.sessions.size + 1,
      userId: user.id,
      email: user.email,
      role: user.role,
      sessionTokenHash: input.sessionTokenHash,
      expiresAt: input.expiresAt,
      revokedAt: null
    };

    this.sessions.set(input.sessionTokenHash, session);

    return session;
  }

  async getSessionByTokenHash(sessionTokenHash: string, now: string): Promise<AdminAuthSession | null> {
    const session = this.sessions.get(sessionTokenHash);

    if (session === undefined || session.revokedAt !== null || Date.parse(session.expiresAt) <= Date.parse(now)) {
      return null;
    }

    return session;
  }

  async revokeSession(sessionTokenHash: string, now: string): Promise<boolean> {
    const session = this.sessions.get(sessionTokenHash);

    if (session === undefined) {
      return false;
    }

    this.sessions.set(sessionTokenHash, {
      ...session,
      revokedAt: now
    });

    return true;
  }
}

describe("admin auth primitives", () => {
  test("password hash is not raw password and verifies valid credentials", async () => {
    const password = "correct horse battery staple";
    const hash = await hashAdminPassword(password);

    expect(hash).not.toBe(password);
    expect(await verifyAdminPassword(password, hash)).toBe(true);
    expect(await verifyAdminPassword("wrong password", hash)).toBe(false);
  });

  test("disabled users cannot create sessions", async () => {
    const store = new MemoryAuthStore();
    store.users.set(1, {
      id: 1,
      email: "admin@example.com",
      role: "admin",
      disabledAt: "2026-05-14T00:00:00.000Z"
    });

    await expect(
      createAdminSession({
        store,
        userId: 1,
        now: () => "2026-05-14T12:00:00.000Z",
        ttlSeconds: 3600
      })
    ).rejects.toThrow("disabled");
  });

  test("expired and revoked sessions are rejected", async () => {
    const store = new MemoryAuthStore();
    store.users.set(1, { id: 1, email: "viewer@example.com", role: "viewer", disabledAt: null });
    const created = await createAdminSession({
      store,
      userId: 1,
      now: () => "2026-05-14T12:00:00.000Z",
      ttlSeconds: 1
    });

    expect(await store.getSessionByTokenHash(hashSessionToken(created.token), "2026-05-14T12:00:02.000Z")).toBeNull();
    expect(await store.revokeSession(hashSessionToken(created.token), "2026-05-14T12:00:00.500Z")).toBe(true);
    expect(await store.getSessionByTokenHash(hashSessionToken(created.token), "2026-05-14T12:00:00.750Z")).toBeNull();
  });

  test("viewer cannot pass admin role guard", async () => {
    const app = new Hono<{ Variables: { adminUser: AdminPrincipal } }>();
    app.use("*", async (context, next) => {
      context.set("adminUser", {
        id: 2,
        email: "viewer@example.com",
        role: "viewer"
      });
      await next();
    });
    app.post("/admin-only", requireAdminRole(), (context) => context.json({ ok: true }));

    const response = await app.request("/admin-only", { method: "POST" });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      ok: false,
      error: {
        code: "forbidden",
        message: "Admin role is required.",
        status: 403
      }
    });
  });

  test("auth middleware rejects requests without a session cookie", async () => {
    const store = new MemoryAuthStore();
    const app = new Hono<{ Variables: { adminUser: AdminPrincipal } }>();
    app.use("*", createAdminAuthMiddleware({ store, now: () => "2026-05-14T12:00:00.000Z" }));
    app.get("/me", (context) => context.json({ ok: true, user: context.get("adminUser") }));

    const response = await app.request("/me");

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      ok: false,
      error: {
        code: "unauthorized",
        message: "Authentication is required.",
        status: 401
      }
    });
  });

  test("login rate limiter blocks after bounded failures and can be cleared", () => {
    let now = 0;
    const limiter = new InMemoryLoginRateLimiter({
      maxAttempts: 2,
      windowSeconds: 60,
      now: () => now
    });

    expect(limiter.isLimited("admin@example.com")).toBe(false);
    limiter.recordFailure("admin@example.com");
    limiter.recordFailure("admin@example.com");
    expect(limiter.isLimited("admin@example.com")).toBe(true);
    limiter.clear("admin@example.com");
    expect(limiter.isLimited("admin@example.com")).toBe(false);
    limiter.recordFailure("admin@example.com");
    now = 61_000;
    expect(limiter.isLimited("admin@example.com")).toBe(false);
  });
});
