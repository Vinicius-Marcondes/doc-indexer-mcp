import { Database } from "bun:sqlite";
import { agentCitationMapSchema, agentFindingSchema, agentWarningSchema, type AgentCitationMap, type AgentFinding, type AgentWarning } from "../shared/agent-output";

export interface FindingCacheWrite {
  readonly projectHash: string;
  readonly scope: string;
  readonly relativePath?: string;
  readonly fileHash?: string;
  readonly ruleId: string;
  readonly fingerprint: string;
  readonly finding: AgentFinding;
  readonly sourceContentHashes: Readonly<Record<string, string>>;
  readonly generatedAt: string;
  readonly schemaVersion: string;
}

export interface FindingCacheLookup {
  readonly projectHash: string;
  readonly fingerprint: string;
  readonly fileHash?: string;
  readonly sourceContentHashes: Readonly<Record<string, string>>;
  readonly schemaVersion: string;
}

export interface FindingCacheReuseLookup {
  readonly projectHash: string;
  readonly scope: string;
  readonly relativePath?: string;
  readonly ruleId: string;
  readonly fileHash?: string;
  readonly sourceContentHashes: Readonly<Record<string, string>>;
  readonly schemaVersion: string;
}

export interface CachedFinding {
  readonly projectHash: string;
  readonly scope: string;
  readonly relativePath?: string;
  readonly fileHash?: string;
  readonly ruleId: string;
  readonly fingerprint: string;
  readonly finding: AgentFinding;
  readonly sourceContentHashes: Record<string, string>;
  readonly generatedAt: string;
  readonly schemaVersion: string;
}

export interface FindingProjectFileHash {
  readonly relativePath: string;
  readonly contentHash: string;
}

export interface FindingProjectSnapshotWrite {
  readonly projectHash: string;
  readonly projectPath: string;
  readonly generatedAt: string;
  readonly schemaVersion: string;
  readonly findings: readonly AgentFinding[];
  readonly citations: AgentCitationMap;
  readonly fileHashes: readonly FindingProjectFileHash[];
  readonly warnings: readonly AgentWarning[];
}

export interface FindingProjectSnapshot {
  readonly projectHash: string;
  readonly projectPath: string;
  readonly generatedAt: string;
  readonly schemaVersion: string;
  readonly findings: AgentFinding[];
  readonly citations: AgentCitationMap;
  readonly fileHashes: FindingProjectFileHash[];
  readonly warnings: AgentWarning[];
}

interface FindingCacheRow {
  project_hash: string;
  scope: string;
  relative_path: string | null;
  file_hash: string | null;
  rule_id: string;
  fingerprint: string;
  finding_json: string;
  source_content_hashes_json: string;
  generated_at: string;
  schema_version: string;
}

interface FindingProjectSnapshotRow {
  project_hash: string;
  project_path: string;
  generated_at: string;
  schema_version: string;
  findings_json: string;
  citations_json: string;
  file_hashes_json: string;
  warnings_json: string;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }

  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function sourceHashesEqual(left: Readonly<Record<string, string>>, right: Readonly<Record<string, string>>): boolean {
  return stableJson(left) === stableJson(right);
}

function rowToCachedFinding(row: FindingCacheRow): CachedFinding {
  const sourceContentHashes = JSON.parse(row.source_content_hashes_json) as Record<string, string>;

  return {
    projectHash: row.project_hash,
    scope: row.scope,
    ...(row.relative_path === null ? {} : { relativePath: row.relative_path }),
    ...(row.file_hash === null ? {} : { fileHash: row.file_hash }),
    ruleId: row.rule_id,
    fingerprint: row.fingerprint,
    finding: agentFindingSchema.parse(JSON.parse(row.finding_json)),
    sourceContentHashes,
    generatedAt: row.generated_at,
    schemaVersion: row.schema_version
  };
}

function rowToProjectSnapshot(row: FindingProjectSnapshotRow): FindingProjectSnapshot {
  return {
    projectHash: row.project_hash,
    projectPath: row.project_path,
    generatedAt: row.generated_at,
    schemaVersion: row.schema_version,
    findings: (JSON.parse(row.findings_json) as unknown[]).map((finding) => agentFindingSchema.parse(finding)),
    citations: agentCitationMapSchema.parse(JSON.parse(row.citations_json)),
    fileHashes: JSON.parse(row.file_hashes_json) as FindingProjectFileHash[],
    warnings: (JSON.parse(row.warnings_json) as unknown[]).map((warning) => agentWarningSchema.parse(warning))
  };
}

function isCurrent(entry: CachedFinding, input: FindingCacheLookup | FindingCacheReuseLookup): boolean {
  return (
    entry.schemaVersion === input.schemaVersion &&
    (input.fileHash ?? null) === (entry.fileHash ?? null) &&
    sourceHashesEqual(entry.sourceContentHashes, input.sourceContentHashes)
  );
}

export class FindingCacheStore {
  readonly path: string;
  private readonly db: Database;

  constructor(path: string) {
    this.path = path;
    this.db = new Database(path, { create: true });
    this.initialize();
  }

  private initialize(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS finding_entries (
        project_hash TEXT NOT NULL,
        scope TEXT NOT NULL,
        relative_path TEXT,
        file_hash TEXT,
        rule_id TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        finding_json TEXT NOT NULL,
        source_content_hashes_json TEXT NOT NULL,
        generated_at TEXT NOT NULL,
        schema_version TEXT NOT NULL,
        PRIMARY KEY (
          project_hash,
          scope,
          relative_path,
          rule_id,
          fingerprint,
          schema_version
        )
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS finding_project_snapshots (
        project_hash TEXT NOT NULL PRIMARY KEY,
        project_path TEXT NOT NULL,
        generated_at TEXT NOT NULL,
        schema_version TEXT NOT NULL,
        findings_json TEXT NOT NULL,
        citations_json TEXT NOT NULL,
        file_hashes_json TEXT NOT NULL,
        warnings_json TEXT NOT NULL
      )
    `);
  }

  setFinding(entry: FindingCacheWrite): CachedFinding {
    this.db
      .query(
        `
        INSERT INTO finding_entries (
          project_hash,
          scope,
          relative_path,
          file_hash,
          rule_id,
          fingerprint,
          finding_json,
          source_content_hashes_json,
          generated_at,
          schema_version
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(project_hash, scope, relative_path, rule_id, fingerprint, schema_version) DO UPDATE SET
          file_hash = excluded.file_hash,
          finding_json = excluded.finding_json,
          source_content_hashes_json = excluded.source_content_hashes_json,
          generated_at = excluded.generated_at
      `
      )
      .run(
        entry.projectHash,
        entry.scope,
        entry.relativePath ?? null,
        entry.fileHash ?? null,
        entry.ruleId,
        entry.fingerprint,
        JSON.stringify(entry.finding),
        stableJson(entry.sourceContentHashes),
        entry.generatedAt,
        entry.schemaVersion
      );

    return {
      projectHash: entry.projectHash,
      scope: entry.scope,
      ...(entry.relativePath === undefined ? {} : { relativePath: entry.relativePath }),
      ...(entry.fileHash === undefined ? {} : { fileHash: entry.fileHash }),
      ruleId: entry.ruleId,
      fingerprint: entry.fingerprint,
      finding: entry.finding,
      sourceContentHashes: { ...entry.sourceContentHashes },
      generatedAt: entry.generatedAt,
      schemaVersion: entry.schemaVersion
    };
  }

  getFinding(input: FindingCacheLookup): CachedFinding | null {
    const row = this.db
      .query(
        `
        SELECT * FROM finding_entries
        WHERE project_hash = ?
          AND fingerprint = ?
          AND schema_version = ?
        ORDER BY generated_at DESC
        LIMIT 1
      `
      )
      .get(input.projectHash, input.fingerprint, input.schemaVersion) as FindingCacheRow | null;

    if (row === null) {
      return null;
    }

    const cached = rowToCachedFinding(row);
    return isCurrent(cached, input) ? cached : null;
  }

  reuseFinding(input: FindingCacheReuseLookup): CachedFinding | null {
    const row = this.db
      .query(
        `
        SELECT * FROM finding_entries
        WHERE project_hash = ?
          AND scope = ?
          AND relative_path IS ?
          AND rule_id = ?
          AND schema_version = ?
        ORDER BY generated_at DESC
        LIMIT 1
      `
      )
      .get(
        input.projectHash,
        input.scope,
        input.relativePath ?? null,
        input.ruleId,
        input.schemaVersion
      ) as FindingCacheRow | null;

    if (row === null) {
      return null;
    }

    const cached = rowToCachedFinding(row);
    return isCurrent(cached, input) ? cached : null;
  }

  setProjectSnapshot(snapshot: FindingProjectSnapshotWrite): FindingProjectSnapshot {
    this.db
      .query(
        `
        INSERT INTO finding_project_snapshots (
          project_hash,
          project_path,
          generated_at,
          schema_version,
          findings_json,
          citations_json,
          file_hashes_json,
          warnings_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(project_hash) DO UPDATE SET
          project_path = excluded.project_path,
          generated_at = excluded.generated_at,
          schema_version = excluded.schema_version,
          findings_json = excluded.findings_json,
          citations_json = excluded.citations_json,
          file_hashes_json = excluded.file_hashes_json,
          warnings_json = excluded.warnings_json
      `
      )
      .run(
        snapshot.projectHash,
        snapshot.projectPath,
        snapshot.generatedAt,
        snapshot.schemaVersion,
        JSON.stringify(snapshot.findings),
        JSON.stringify(snapshot.citations),
        JSON.stringify(snapshot.fileHashes),
        JSON.stringify(snapshot.warnings)
      );

    return {
      projectHash: snapshot.projectHash,
      projectPath: snapshot.projectPath,
      generatedAt: snapshot.generatedAt,
      schemaVersion: snapshot.schemaVersion,
      findings: [...snapshot.findings],
      citations: snapshot.citations,
      fileHashes: [...snapshot.fileHashes],
      warnings: [...snapshot.warnings]
    };
  }

  getProjectSnapshot(projectHash: string): FindingProjectSnapshot | null {
    const row = this.db
      .query("SELECT * FROM finding_project_snapshots WHERE project_hash = ?")
      .get(projectHash) as FindingProjectSnapshotRow | null;

    return row === null ? null : rowToProjectSnapshot(row);
  }

  close(): void {
    this.db.close();
  }
}
