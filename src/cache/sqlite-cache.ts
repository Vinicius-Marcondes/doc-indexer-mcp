import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import type { CacheStatus, SourceType } from "../shared/contracts";

export interface CacheEntry {
  readonly key: string;
  readonly sourceType: SourceType;
  readonly sourceUrl?: string;
  readonly content: string;
  readonly contentHash: string;
  readonly fetchedAt: string;
  readonly expiresAt: string;
  readonly status: string;
  readonly errorSummary?: string;
}

export interface CacheWrite {
  readonly key: string;
  readonly sourceType: SourceType;
  readonly sourceUrl?: string;
  readonly content: string;
  readonly fetchedAt: string;
  readonly expiresAt: string;
  readonly status: string;
  readonly errorSummary?: string;
}

export interface CacheHit {
  readonly cacheStatus: Extract<CacheStatus, "fresh" | "stale">;
  readonly entry: CacheEntry;
}

export interface CacheMiss {
  readonly cacheStatus: "miss";
  readonly entry: null;
}

export type CacheLookup = CacheHit | CacheMiss;

interface CacheRow {
  key: string;
  source_type: SourceType;
  source_url: string | null;
  content: string;
  content_hash: string;
  fetched_at: string;
  expires_at: string;
  status: string;
  error_summary: string | null;
}

export function computeContentHash(content: string): string {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\s+$/u, "");
  return createHash("sha256").update(normalized).digest("hex");
}

function rowToEntry(row: CacheRow): CacheEntry {
  return {
    key: row.key,
    sourceType: row.source_type,
    ...(row.source_url === null ? {} : { sourceUrl: row.source_url }),
    content: row.content,
    contentHash: row.content_hash,
    fetchedAt: row.fetched_at,
    expiresAt: row.expires_at,
    status: row.status,
    ...(row.error_summary === null ? {} : { errorSummary: row.error_summary })
  };
}

function freshness(entry: CacheEntry, now: string): CacheHit["cacheStatus"] {
  return Date.parse(entry.expiresAt) > Date.parse(now) ? "fresh" : "stale";
}

export class SqliteCacheStore {
  readonly path: string;
  private readonly db: Database;

  constructor(path: string) {
    this.path = path;
    this.db = new Database(path, { create: true });
    this.initialize();
  }

  private initialize(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS cache_entries (
        key TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_url TEXT,
        content TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        status TEXT NOT NULL,
        error_summary TEXT,
        PRIMARY KEY (key, source_type)
      )
    `);
  }

  hasSchema(): boolean {
    const row = this.db
      .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'cache_entries'")
      .get();
    return row !== null;
  }

  set(entry: CacheWrite): CacheEntry {
    const contentHash = computeContentHash(entry.content);

    this.db
      .query(
        `
        INSERT INTO cache_entries (
          key,
          source_type,
          source_url,
          content,
          content_hash,
          fetched_at,
          expires_at,
          status,
          error_summary
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(key, source_type) DO UPDATE SET
          source_url = excluded.source_url,
          content = excluded.content,
          content_hash = excluded.content_hash,
          fetched_at = excluded.fetched_at,
          expires_at = excluded.expires_at,
          status = excluded.status,
          error_summary = excluded.error_summary
      `
      )
      .run(
        entry.key,
        entry.sourceType,
        entry.sourceUrl ?? null,
        entry.content,
        contentHash,
        entry.fetchedAt,
        entry.expiresAt,
        entry.status,
        entry.errorSummary ?? null
      );

    return {
      ...entry,
      contentHash
    };
  }

  get(key: string, sourceType: SourceType, now: string = new Date().toISOString()): CacheLookup {
    const row = this.db
      .query("SELECT * FROM cache_entries WHERE key = ? AND source_type = ?")
      .get(key, sourceType) as CacheRow | null;

    if (row === null) {
      return {
        cacheStatus: "miss",
        entry: null
      };
    }

    const entry = rowToEntry(row);

    return {
      cacheStatus: freshness(entry, now),
      entry
    };
  }

  getStale(key: string, sourceType: SourceType): CacheEntry | null {
    const lookup = this.get(key, sourceType);
    return lookup.entry;
  }

  delete(key: string, sourceType: SourceType): void {
    this.db.query("DELETE FROM cache_entries WHERE key = ? AND source_type = ?").run(key, sourceType);
  }

  clear(): void {
    this.db.run("DELETE FROM cache_entries");
  }

  close(): void {
    this.db.close();
  }
}
