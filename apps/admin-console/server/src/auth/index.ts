import { createHash, randomBytes } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";

export type AdminRole = "admin" | "viewer";

export interface AdminPrincipal {
  readonly id: number;
  readonly email: string;
  readonly role: AdminRole;
}

export interface AdminAuthUser extends AdminPrincipal {
  readonly passwordHash: string;
  readonly disabledAt: string | null;
}

export interface AdminAuthSession extends AdminPrincipal {
  readonly id: number;
  readonly userId: number;
  readonly sessionTokenHash: string;
  readonly expiresAt: string;
  readonly revokedAt: string | null;
}

export interface AdminAuthStore {
  readonly getUserById: (id: number) => Promise<AdminAuthUser | Pick<AdminAuthUser, "id" | "email" | "role" | "disabledAt"> | null>;
  readonly createSession: (input: CreateAdminSessionStorageInput) => Promise<AdminAuthSession>;
  readonly getSessionByTokenHash: (sessionTokenHash: string, now: string) => Promise<AdminAuthSession | null>;
  readonly revokeSession: (sessionTokenHash: string, now: string) => Promise<boolean>;
}

export interface CreateAdminSessionStorageInput {
  readonly userId: number;
  readonly sessionTokenHash: string;
  readonly expiresAt: string;
  readonly userAgentHash?: string;
  readonly ipHash?: string;
  readonly now: string;
}

export interface CreateAdminSessionInput {
  readonly store: AdminAuthStore;
  readonly userId: number;
  readonly now: () => string;
  readonly ttlSeconds: number;
  readonly userAgent?: string;
  readonly ip?: string;
}

export interface CreatedAdminSession {
  readonly token: string;
  readonly session: AdminAuthSession;
}

export interface SqlClient {
  <T extends readonly Record<string, unknown>[] = Record<string, unknown>[]>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T>;
}

export interface CreateAdminUserInput {
  readonly email: string;
  readonly passwordHash: string;
  readonly role: AdminRole;
  readonly now: string;
}

export interface BootstrapAdminInput {
  readonly storage: AdminAuthStorage;
  readonly env: Record<string, string | undefined>;
  readonly now: () => string;
}

export type BootstrapAdminResult =
  | {
      readonly status: "created";
      readonly user: AdminPrincipal;
    }
  | {
      readonly status: "skipped_existing_user" | "skipped_missing_env";
    };

interface UserRow extends Record<string, unknown> {
  readonly id: number;
  readonly email: string;
  readonly password_hash: string;
  readonly role: AdminRole;
  readonly disabled_at: string | null;
}

interface SessionRow extends Record<string, unknown> {
  readonly id: number;
  readonly user_id: number;
  readonly email: string;
  readonly role: AdminRole;
  readonly session_token_hash: string;
  readonly expires_at: string;
  readonly revoked_at: string | null;
}

export const adminSessionCookieName = "bun_dev_intel_admin_session";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function toIsoString(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? value : new Date(timestamp).toISOString();
}

function mapUser(row: UserRow): AdminAuthUser {
  return {
    id: Number(row.id),
    email: row.email,
    passwordHash: row.password_hash,
    role: row.role,
    disabledAt: toIsoString(row.disabled_at)
  };
}

function mapSession(row: SessionRow): AdminAuthSession {
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    email: row.email,
    role: row.role,
    sessionTokenHash: row.session_token_hash,
    expiresAt: toIsoString(row.expires_at) ?? row.expires_at,
    revokedAt: toIsoString(row.revoked_at)
  };
}

function hashOptionalField(value: string | undefined): string | undefined {
  if (value === undefined || value.length === 0) {
    return undefined;
  }

  return createHash("sha256").update(value).digest("hex");
}

function jsonError(context: Context, status: 401 | 403, code: string, message: string): Response {
  return context.json(
    {
      ok: false,
      error: {
        code,
        message,
        status
      }
    },
    status
  );
}

export async function hashAdminPassword(password: string): Promise<string> {
  return Bun.password.hash(password);
}

export async function verifyAdminPassword(password: string, passwordHash: string): Promise<boolean> {
  return Bun.password.verify(password, passwordHash);
}

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createAdminSession(input: CreateAdminSessionInput): Promise<CreatedAdminSession> {
  const user = await input.store.getUserById(input.userId);

  if (user === null || user.disabledAt !== null) {
    throw new Error("Cannot create a session for a disabled or missing user.");
  }

  const now = input.now();
  const nowMs = Date.parse(now);
  const baseMs = Number.isNaN(nowMs) ? Date.now() : nowMs;
  const token = generateSessionToken();
  const session = await input.store.createSession({
    userId: input.userId,
    sessionTokenHash: hashSessionToken(token),
    expiresAt: new Date(baseMs + input.ttlSeconds * 1000).toISOString(),
    userAgentHash: hashOptionalField(input.userAgent),
    ipHash: hashOptionalField(input.ip),
    now
  });

  return { token, session };
}

export function createAdminSessionCookie(input: {
  readonly token: string;
  readonly expiresAt: string;
  readonly secure: boolean;
}): string {
  const parts = [
    `${adminSessionCookieName}=${input.token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${new Date(input.expiresAt).toUTCString()}`
  ];

  if (input.secure) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

export function createClearAdminSessionCookie(input: { readonly secure: boolean }): string {
  const parts = [
    `${adminSessionCookieName}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT"
  ];

  if (input.secure) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

export function createAdminAuthMiddleware(input: {
  readonly store: AdminAuthStore;
  readonly now: () => string;
}): MiddlewareHandler<{ Variables: { adminUser: AdminPrincipal } }> {
  return async (context, next) => {
    const token = getCookie(context, adminSessionCookieName);

    if (token === undefined) {
      return jsonError(context, 401, "unauthorized", "Authentication is required.");
    }

    const session = await input.store.getSessionByTokenHash(hashSessionToken(token), input.now());

    if (session === null) {
      return jsonError(context, 401, "unauthorized", "Authentication is required.");
    }

    context.set("adminUser", {
      id: session.userId,
      email: session.email,
      role: session.role
    });

    await next();
  };
}

export function requireAdminRole(): MiddlewareHandler<{ Variables: { adminUser: AdminPrincipal } }> {
  return async (context, next) => {
    const user = context.get("adminUser");

    if (user.role !== "admin") {
      return jsonError(context, 403, "forbidden", "Admin role is required.");
    }

    await next();
  };
}

export class InMemoryLoginRateLimiter {
  private readonly attempts = new Map<string, { count: number; resetAtMs: number }>();

  constructor(
    private readonly options: {
      readonly maxAttempts: number;
      readonly windowSeconds: number;
      readonly now: () => number;
    }
  ) {}

  isLimited(key: string): boolean {
    const entry = this.attempts.get(key);

    if (entry === undefined || entry.resetAtMs <= this.options.now()) {
      return false;
    }

    return entry.count >= this.options.maxAttempts;
  }

  recordFailure(key: string): void {
    const now = this.options.now();
    const existing = this.attempts.get(key);

    if (existing === undefined || existing.resetAtMs <= now) {
      this.attempts.set(key, {
        count: 1,
        resetAtMs: now + this.options.windowSeconds * 1000
      });
      return;
    }

    this.attempts.set(key, {
      ...existing,
      count: existing.count + 1
    });
  }

  clear(key: string): void {
    this.attempts.delete(key);
  }
}

export class AdminAuthStorage implements AdminAuthStore {
  constructor(private readonly sql: SqlClient) {}

  async countUsers(): Promise<number> {
    const rows = await this.sql<Array<{ count: number }>>`
      select count(*)::integer as count
      from admin_users
    `;

    return Number(rows[0]?.count ?? 0);
  }

  async createUser(input: CreateAdminUserInput): Promise<AdminAuthUser> {
    const rows = await this.sql<UserRow[]>`
      insert into admin_users (email, normalized_email, password_hash, role, created_at, updated_at)
      values (${input.email.trim()}, ${normalizeEmail(input.email)}, ${input.passwordHash}, ${input.role}, ${input.now}, ${input.now})
      returning id, email, password_hash, role, disabled_at::text as disabled_at
    `;
    const row = rows[0];

    if (row === undefined) {
      throw new Error("Expected admin user row after insert.");
    }

    return mapUser(row);
  }

  async getUserByEmail(email: string): Promise<AdminAuthUser | null> {
    const rows = await this.sql<UserRow[]>`
      select id, email, password_hash, role, disabled_at::text as disabled_at
      from admin_users
      where normalized_email = ${normalizeEmail(email)}
      limit 1
    `;

    return rows[0] === undefined ? null : mapUser(rows[0]);
  }

  async getUserById(id: number): Promise<AdminAuthUser | null> {
    const rows = await this.sql<UserRow[]>`
      select id, email, password_hash, role, disabled_at::text as disabled_at
      from admin_users
      where id = ${id}
      limit 1
    `;

    return rows[0] === undefined ? null : mapUser(rows[0]);
  }

  async createSession(input: CreateAdminSessionStorageInput): Promise<AdminAuthSession> {
    const user = await this.getUserById(input.userId);

    if (user === null || user.disabledAt !== null) {
      throw new Error("Cannot create a session for a disabled or missing user.");
    }

    const rows = await this.sql<SessionRow[]>`
      insert into admin_sessions (
        user_id, session_token_hash, expires_at, created_at, last_seen_at, user_agent_hash, ip_hash
      )
      values (
        ${input.userId},
        ${input.sessionTokenHash},
        ${input.expiresAt},
        ${input.now},
        ${input.now},
        ${input.userAgentHash ?? null},
        ${input.ipHash ?? null}
      )
      returning
        id,
        user_id,
        ${user.email}::text as email,
        ${user.role}::text as role,
        session_token_hash,
        expires_at::text as expires_at,
        revoked_at::text as revoked_at
    `;
    const row = rows[0];

    if (row === undefined) {
      throw new Error("Expected admin session row after insert.");
    }

    return mapSession(row);
  }

  async getSessionByTokenHash(sessionTokenHash: string, now: string): Promise<AdminAuthSession | null> {
    const rows = await this.sql<SessionRow[]>`
      select
        s.id,
        s.user_id,
        u.email,
        u.role,
        s.session_token_hash,
        s.expires_at::text as expires_at,
        s.revoked_at::text as revoked_at
      from admin_sessions s
      join admin_users u on u.id = s.user_id
      where s.session_token_hash = ${sessionTokenHash}
        and s.revoked_at is null
        and s.expires_at > ${now}
        and u.disabled_at is null
      limit 1
    `;

    return rows[0] === undefined ? null : mapSession(rows[0]);
  }

  async revokeSession(sessionTokenHash: string, now: string): Promise<boolean> {
    const rows = await this.sql<Array<{ id: number }>>`
      update admin_sessions
      set revoked_at = ${now}
      where session_token_hash = ${sessionTokenHash}
        and revoked_at is null
      returning id
    `;

    return rows.length > 0;
  }
}

export async function bootstrapFirstAdminUser(input: BootstrapAdminInput): Promise<BootstrapAdminResult> {
  const existingUsers = await input.storage.countUsers();

  if (existingUsers > 0) {
    return { status: "skipped_existing_user" };
  }

  const email = input.env.ADMIN_BOOTSTRAP_EMAIL?.trim();
  const password = input.env.ADMIN_BOOTSTRAP_PASSWORD;

  if (email === undefined || email.length === 0 || password === undefined || password.length === 0) {
    return { status: "skipped_missing_env" };
  }

  const user = await input.storage.createUser({
    email,
    passwordHash: await hashAdminPassword(password),
    role: "admin",
    now: input.now()
  });

  return {
    status: "created",
    user: {
      id: user.id,
      email: user.email,
      role: user.role
    }
  };
}
