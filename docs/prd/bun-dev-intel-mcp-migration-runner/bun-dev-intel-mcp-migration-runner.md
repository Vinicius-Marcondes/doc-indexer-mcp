# PRD: Migration Runner with Schema Migration Tracking

## 1. Summary

The `doc-repository-mcp` monorepo currently bootstraps its Postgres schema by re-executing every `.sql` file under `migrations/remote-docs/` on every process startup. Idempotency depends entirely on the SQL authors remembering to wrap every statement in `IF NOT EXISTS` / `IF EXISTS` guards. This works for the three additive migrations that exist today but is structurally unsafe: any future `ALTER TABLE`, `DROP COLUMN`, `INSERT` seed, backfill, or non-idempotent DDL would silently re-run on every restart, causing duplicate work, data corruption, or repeated failures across the three runtimes (`apps/mcp-http`, `apps/docs-worker`, `apps/admin-console/server`) that all execute `bun run db:migrate` at boot.

This PRD specifies a minimal, conventional schema-migration tracking system for the existing custom runner in `packages/db/src/database.ts`. The runner will gain a `schema_migrations` tracking table, skip already-applied migrations, bootstrap the tracking table itself on first run, and use a Postgres advisory lock to be safe under concurrent startup of the three apps and `docker compose up`.

This PRD is documentation only; no implementation should be performed without an accompanying task plan. It describes the target behavior, the exact tracking-table DDL, the runner algorithm, error handling, and acceptance criteria so the change can be implemented and reviewed against a clear spec.

## 2. Motivation

The current runner in `packages/db/src/database.ts`:

- Globs `migrations/remote-docs/*.sql`, sorts alphabetically, and executes each via `sql.unsafe(migration.sql)` on every startup.
- Has no tracking table. There is no record of which migrations ran, when, or against which schema.
- Relies on every SQL file being fully idempotent via `IF NOT EXISTS` guards.

Concrete failure scenarios this creates:

1. **Destructive DDL re-runs.** A future `0005_drop_legacy_column.sql` containing `ALTER TABLE doc_pages DROP COLUMN legacy_field;` would succeed on first boot, then fail (or worse, silently no-op via `IF EXISTS`) every subsequent boot, masking real schema drift.
2. **Backfills repeat.** A migration that runs `UPDATE doc_chunks SET ... WHERE ...` to rewrite content would re-execute on every restart, repeatedly mutating rows or repeatedly scanning the table for no reason.
3. **Seed inserts duplicate.** `INSERT INTO admin_users ...` without `ON CONFLICT` would either explode on the second boot or, with `ON CONFLICT DO NOTHING`, mask drift between intended seed and actual state.
4. **Concurrent startup races.** `docker compose up` brings up `mcp-http`, `docs-worker`, and `admin-console-server` near-simultaneously. All three race to run the same DDL. With purely guarded SQL it usually works; without guards it crashes one or more containers on boot.
5. **No audit trail.** Operators have no way to ask "was 0003 applied to this database?" without inspecting the live schema, which is brittle.
6. **No safety net for human error.** A new contributor writing a migration without `IF NOT EXISTS` will not notice the problem in dev (first boot succeeds) and will ship a container that crashes on restart in production.

A standard `schema_migrations` tracking table is the conventional fix and is small enough to land without introducing a migration framework dependency.

## 3. Target Users

- **Backend engineers** authoring future migrations under `migrations/remote-docs/` who should be able to write ordinary (non-idempotent) DDL with confidence that it runs exactly once.
- **Operators / SREs** restarting containers, running `docker compose up`, and rolling new images, who need predictable startup behavior and an auditable record of applied migrations.
- **Reviewers** auditing a Postgres instance to confirm which migrations have been applied to that environment.

## 4. Goals

- Add a `schema_migrations` tracking table that records every applied migration by filename and timestamp.
- Modify the runner in `packages/db/src/database.ts` to skip migrations whose filenames are already present in `schema_migrations`.
- Make first-run bootstrap correct: the runner must work against a fresh database where `schema_migrations` does not yet exist.
- Make concurrent startup safe: when multiple processes (mcp-http, docs-worker, admin-console-server) boot at once they must not race on the same migration.
- Preserve alphabetical ordering of migration files (the existing convention).
- Keep the implementation dependency-free: continue using `postgres.js` directly, no new migration library.
- Record applied migrations in a single transaction with the migration body so a partial failure does not leave the tracking table out of sync with reality.

## 5. Non-Goals For V1

- No down/rollback migrations. The system is forward-only.
- No checksums / content hashing of migration files. Filename is the unique key. Editing an already-applied migration is out of scope and will not be detected.
- No migration generator CLI, no `bun run db:migrate:create`. Files are still hand-authored.
- No support for multiple migration directories. Only `migrations/remote-docs/` is in scope.
- No "pending migrations" reporting CLI in this PRD; that can come later.
- No automatic backfill of `schema_migrations` rows for existing deployments — handled by the bootstrap rule in Section 6.
- No change to the three SQL files already in the repo. They remain as-is.
- No ORM, no Drizzle, no Prisma, no node-pg-migrate.

## 6. Product Scope

### Implementation Target

- Language: TypeScript, executed on the Bun runtime.
- Driver: `postgres.js` v3 (already in use).
- Files touched:
  - New: `migrations/remote-docs/0004_schema_migrations_table.sql`
  - Modified: `packages/db/src/database.ts` (runner logic)
- No new runtime dependencies. No build-step changes. No change to `bun run db:migrate` invocation in `docker-compose.yml`.

### Tracking Table DDL

The new migration `migrations/remote-docs/0004_schema_migrations_table.sql` creates:

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename     TEXT        PRIMARY KEY,
  applied_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Design notes:

- `filename` is the bare filename (e.g., `0001_remote_docs_schema.sql`), not a path. The runner strips directory components before insert/lookup.
- `PRIMARY KEY` on `filename` gives us both uniqueness and the index we need for the skip check.
- `applied_at` defaults to `NOW()` so the runner only writes the filename.
- No `id` surrogate, no `checksum`, no `execution_time_ms` — kept intentionally minimal for V1.

### Runner Algorithm

The runner runs once per process startup. Pseudocode:

```
1. Connect to Postgres via the shared client.
2. Acquire a session-scoped Postgres advisory lock:
     SELECT pg_advisory_lock(<constant int8>);
   The constant is a fixed application-wide key
   (e.g., hashtext('doc-repository-mcp:schema_migrations') cast to bigint,
   or a hardcoded value like 727073091).
3. Bootstrap: execute the contents of
     migrations/remote-docs/0004_schema_migrations_table.sql
   directly via sql.unsafe(...). The CREATE TABLE IF NOT EXISTS makes this
   safe to run before we know whether the table exists. Then INSERT its own
   row into schema_migrations with ON CONFLICT (filename) DO NOTHING.
4. SELECT filename FROM schema_migrations  -> applied: Set<string>.
5. List migrations/remote-docs/*.sql, sort alphabetically.
6. For each migration file NOT in applied:
     a. BEGIN;
     b. sql.unsafe(<file contents>);
     c. INSERT INTO schema_migrations (filename) VALUES ($1)
        ON CONFLICT (filename) DO NOTHING;
     d. COMMIT;
   On any error in (b) or (c): ROLLBACK, log filename and error, rethrow
   so the process exits non-zero and the container restart-loops visibly.
7. SELECT pg_advisory_unlock(<constant int8>);
8. Return.
```

Key behaviors:

- **Idempotent bootstrap.** Step 3 always runs `CREATE TABLE IF NOT EXISTS schema_migrations` before reading from it, so a fresh database and an existing database take the same code path. The bootstrap migration also records itself, so it appears in `schema_migrations` and is not reapplied.
- **One transaction per migration.** Each user-authored migration body runs in the same transaction as its tracking-table insert. There is no window in which a migration's DDL has executed but its tracking row is missing.
- **Advisory lock.** `pg_advisory_lock` is session-scoped on the same `postgres.js` connection used by the runner. The three runtimes serialize through it. The lock is released explicitly in step 7 and implicitly on connection close.
- **First-run on existing deployments.** On environments that already ran `0001`/`0002`/`0003` under the old runner, the new logic will attempt to re-execute those files. Because all three files use `IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` / `CREATE EXTENSION IF NOT EXISTS` guards, re-execution is a no-op. After the first new-runner boot, all four filenames are present in `schema_migrations` and subsequent boots skip them entirely. This avoids any manual backfill step.

### File Discovery

- The runner continues to enumerate `migrations/remote-docs/` (path relative to repo root, resolved as today).
- Only files matching `*.sql` are considered.
- Files are sorted by filename, lexicographically, ascending. The existing `NNNN_` numeric prefix convention is the contract.
- The runner stores and compares only the basename (no directory part).

### Error Handling

- Any thrown error from `sql.unsafe(body)` aborts the transaction for that migration, releases the advisory lock (via connection teardown if needed), and rethrows. The process exits non-zero.
- Logs include: filename, ordinal (e.g., "applying 0004 of 7"), and the underlying Postgres error code and message.
- On success the runner logs one line per applied migration ("applied 0004_schema_migrations_table.sql") and a final summary ("N migrations applied, M already up to date").

### Concurrency Safety

- The advisory lock key is a hardcoded `bigint` constant defined as a module-level `const` in `packages/db/src/database.ts` with a comment explaining its purpose.
- Concurrent startups: the second-arriving process blocks on `pg_advisory_lock` until the first finishes, then proceeds with an up-to-date `schema_migrations` view and finds nothing pending.
- The `ON CONFLICT (filename) DO NOTHING` on every insert is a belt-and-braces safeguard against a hypothetical lock failure; it does not replace the lock.

### Backwards Compatibility

- No change to existing migration filenames or contents.
- No change to the `bun run db:migrate` entrypoint, no change to `docker-compose.yml`.
- Re-running against a database that has already been migrated under the old runner is safe and self-healing (see "First-run on existing deployments" above).

## 7. Implementation Tasks

1. **Add migration file.** Create `migrations/remote-docs/0004_schema_migrations_table.sql` containing the `CREATE TABLE IF NOT EXISTS schema_migrations (...)` DDL from Section 6.
2. **Introduce advisory lock constant.** In `packages/db/src/database.ts`, add a module-level `const MIGRATION_ADVISORY_LOCK_KEY = 727073091n;` (or equivalent) with an explanatory comment.
3. **Bootstrap helper.** In `packages/db/src/database.ts`, add a private function that (a) acquires the advisory lock, (b) executes the `0004` file contents via `sql.unsafe`, (c) inserts the `0004` filename into `schema_migrations` with `ON CONFLICT DO NOTHING`. This runs unconditionally at the top of the migrate routine.
4. **Applied-set query.** Add a step that runs `SELECT filename FROM schema_migrations` and materializes a `Set<string>`.
5. **Skip logic.** Replace the existing "execute every file" loop with one that skips any file whose basename is in the applied set.
6. **Per-migration transaction.** For each non-applied file, wrap the `sql.unsafe(body)` and the tracking insert in a single `sql.begin(async tx => { ... })` block so failure rolls back both.
7. **Lock release.** Ensure the advisory lock is released on both success and failure paths (e.g., `try { ... } finally { await sql`SELECT pg_advisory_unlock(${KEY})`; }`).
8. **Logging.** Emit structured log lines for: migrate start, each skipped file (debug-level), each applied file (info-level), final summary, and errors with filename context.
9. **Smoke test in dev.** Run `docker compose down -v && docker compose up` against a fresh volume; confirm all four migrations apply once. Restart the stack; confirm zero migrations apply on second boot.
10. **Smoke test concurrent startup.** Bring up `mcp-http`, `docs-worker`, and `admin-console-server` simultaneously against an empty database and confirm no errors and exactly one row per migration in `schema_migrations`.
11. **Update `README.md` migrations section** (only the short paragraph describing how migrations are applied) to mention the `schema_migrations` table and forward-only semantics.

## 8. Acceptance Criteria

- [ ] `migrations/remote-docs/0004_schema_migrations_table.sql` exists and contains `CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`.
- [ ] After running `bun run db:migrate` against a fresh database, `SELECT filename FROM schema_migrations ORDER BY filename;` returns exactly the four current filenames: `0001_remote_docs_schema.sql`, `0002_admin_auth_schema.sql`, `0003_admin_audit_events.sql`, `0004_schema_migrations_table.sql`.
- [ ] Running `bun run db:migrate` a second time against the same database executes zero migration bodies and logs a "0 migrations applied" summary.
- [ ] Running `bun run db:migrate` against a database that was previously migrated under the old runner (i.e., has the schema but no `schema_migrations` table) succeeds, populates `schema_migrations` with all four filenames, and is a no-op on the next run.
- [ ] If a migration body raises an error, the corresponding row is NOT inserted into `schema_migrations`, the process exits non-zero, and re-running attempts that migration again.
- [ ] Launching `mcp-http`, `docs-worker`, and `admin-console-server` concurrently against an empty database results in: no startup errors, each migration applied exactly once, and exactly one row per filename in `schema_migrations`.
- [ ] The advisory lock is released after a successful run (`SELECT pg_try_advisory_lock(<key>)` from an external session returns `true` once the runner exits).
- [ ] No new runtime dependencies are added to any `package.json`.
- [ ] The three existing migration files (`0001`, `0002`, `0003`) are unchanged.
- [ ] `bun run db:migrate` still works as the single migration entrypoint; no change is required in `docker-compose.yml` or any app's startup command.
