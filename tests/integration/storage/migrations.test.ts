import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const rootDir = resolve(import.meta.dir, "../../..");
const migrationsDir = resolve(rootDir, "migrations/remote-docs");
const tempSchemas: string[] = [];

function migrationFiles(): string[] {
  return existsSync(migrationsDir) ? readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort() : [];
}

function readMigrationSql(): string {
  return migrationFiles()
    .map((file) => readFileSync(resolve(migrationsDir, file), "utf8"))
    .join("\n")
    .toLowerCase();
}

afterEach(() => {
  for (const schema of tempSchemas.splice(0)) {
    void schema;
  }
});

describe("remote docs Postgres migrations", () => {
  test("migration files are present and ordered", () => {
    expect(migrationFiles()).toEqual(["0001_remote_docs_schema.sql"]);
  });

  test("migration declares pgvector, tables, indexes, and constraints", () => {
    const sql = readMigrationSql();

    expect(sql).toContain("create extension if not exists vector");

    for (const table of [
      "doc_sources",
      "doc_pages",
      "doc_chunks",
      "doc_embeddings",
      "doc_refresh_jobs",
      "doc_retrieval_events"
    ]) {
      expect(sql).toContain(`create table if not exists ${table}`);
    }

    expect(sql).toContain("constraint doc_sources_source_id_key unique");
    expect(sql).toContain("constraint doc_pages_source_canonical_key unique");
    expect(sql).toContain("constraint doc_chunks_page_chunk_index_key unique");
    expect(sql).toContain("constraint doc_embeddings_chunk_provider_model_version_key unique");
    expect(sql).toContain("create unique index if not exists doc_refresh_jobs_pending_dedupe_idx");
    expect(sql).toContain("create index if not exists doc_chunks_search_vector_idx");
    expect(sql).toContain("using gin (search_vector)");
    expect(sql).toContain("embedding vector(1536)");
    expect(sql).toContain("using hnsw (embedding vector_cosine_ops)");
    expect(sql).toContain("doc_retrieval_events_query_hash_idx");
  });

  const testDatabaseUrl = process.env.TEST_DATABASE_URL;
  const postgresTest = testDatabaseUrl === undefined ? test.skip : test;

  postgresTest("migrations run on test Postgres and reject vector dimension mismatch", async () => {
    const postgres = (await import("postgres")).default;
    const sql = postgres(testDatabaseUrl as string, { max: 1 });
    const schemaName = `remote_docs_migration_${crypto.randomUUID().replaceAll("-", "_")}`;
    const migrationSql = readMigrationSql();
    const tempDir = mkdtempSync(resolve(tmpdir(), "remote-docs-migration-"));
    tempSchemas.push(schemaName);

    try {
      await sql.unsafe(`create schema ${schemaName}`);
      await sql.unsafe(`set search_path to ${schemaName}, public`);
      await sql.unsafe(migrationSql);

      const extensions = await sql<{ extname: string }[]>`select extname from pg_extension where extname = 'vector'`;
      const tables = await sql<{ table_name: string }[]>`
        select table_name
        from information_schema.tables
        where table_schema = ${schemaName}
        order by table_name
      `;
      const indexes = await sql<{ indexname: string }[]>`
        select indexname
        from pg_indexes
        where schemaname = ${schemaName}
      `;

      expect(extensions.map((row) => row.extname)).toContain("vector");
      expect(tables.map((row) => row.table_name)).toEqual([
        "doc_chunks",
        "doc_embeddings",
        "doc_pages",
        "doc_refresh_jobs",
        "doc_retrieval_events",
        "doc_sources"
      ]);
      expect(indexes.map((row) => row.indexname)).toContain("doc_chunks_search_vector_idx");
      expect(indexes.map((row) => row.indexname)).toContain("doc_embeddings_embedding_hnsw_idx");

      await sql`
        insert into doc_sources (source_id, display_name, allowed_url_patterns)
        values ('bun', 'Bun docs', '["https://bun.com/docs/*"]'::jsonb)
      `;
      const [page] = await sql<{ id: number }[]>`
        insert into doc_pages (source_id, url, canonical_url, title, content, content_hash, http_status, fetched_at, indexed_at)
        values ('bun', 'https://bun.com/docs/runtime', 'https://bun.com/docs/runtime', 'Runtime', 'Runtime docs', 'page-hash', 200, now(), now())
        returning id
      `;

      if (page === undefined) {
        throw new Error("Expected inserted page row.");
      }

      const [chunk] = await sql<{ id: number }[]>`
        insert into doc_chunks (source_id, page_id, url, title, heading_path, chunk_index, content, content_hash, token_estimate)
        values ('bun', ${page.id}, 'https://bun.com/docs/runtime', 'Runtime', array['Runtime'], 0, 'Bun runtime docs', 'chunk-hash', 3)
        returning id
      `;

      if (chunk === undefined) {
        throw new Error("Expected inserted chunk row.");
      }

      try {
        await sql.unsafe(`
          insert into doc_embeddings (chunk_id, provider, model, embedding_version, dimensions, embedding)
          values (${chunk.id}, 'openai', 'text-embedding-3-small', 'v1', 1536, '[1,2]'::vector)
        `);
        throw new Error("Expected vector dimension mismatch to be rejected.");
      } catch (error) {
        expect(String(error)).toContain("dimension");
      }
    } finally {
      await sql.unsafe(`drop schema if exists ${schemaName} cascade`);
      await sql.end({ timeout: 1 });
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
