import { appendFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

export const auditLogLevelValues = ["NONE", "INFO", "DEBUG", "TRACE"] as const;
export type AuditLogLevel = (typeof auditLogLevelValues)[number];

export interface AuditLogConfig {
  readonly enabled: boolean;
  readonly level: AuditLogLevel;
  readonly filePath?: string;
}

export interface AuditLogEnv {
  readonly BUN_DEV_INTEL_MCP_AUDIT_LOG?: string;
  readonly BUN_DEV_INTEL_MCP_LOG_LEVEL?: string;
}

export interface AuditLogger {
  readonly enabled: boolean;
  readonly level: AuditLogLevel;
  readonly logToolCallStart: (event: ToolCallStartAuditEventInput) => void;
  readonly logToolCallEnd: (event: ToolCallEndAuditEventInput) => void;
}

export interface CreateAuditLoggerOptions {
  readonly env?: AuditLogEnv;
  readonly now?: () => string;
  readonly appendFile?: (filePath: string, data: string) => void;
}

export interface ToolCallStartAuditEventInput {
  readonly toolName: string;
  readonly input: unknown;
}

export interface ToolCallEndAuditEventInput {
  readonly toolName: string;
  readonly input: unknown;
  readonly status: "ok" | "error";
  readonly durationMs: number;
  readonly result?: unknown;
  readonly error?: unknown;
}

type JsonObject = Record<string, unknown>;

function parseLogLevel(value: string | undefined): AuditLogLevel | null {
  if (value === undefined) {
    return "NONE";
  }

  const normalized = value.trim().toUpperCase();

  if (auditLogLevelValues.includes(normalized as AuditLogLevel)) {
    return normalized as AuditLogLevel;
  }

  return null;
}

function defaultAuditLogEnv(): AuditLogEnv {
  return {
    BUN_DEV_INTEL_MCP_AUDIT_LOG: process.env.BUN_DEV_INTEL_MCP_AUDIT_LOG,
    BUN_DEV_INTEL_MCP_LOG_LEVEL: process.env.BUN_DEV_INTEL_MCP_LOG_LEVEL
  };
}

export function parseAuditLogConfig(env: AuditLogEnv = defaultAuditLogEnv()): AuditLogConfig {
  const rawPath = env.BUN_DEV_INTEL_MCP_AUDIT_LOG?.trim();
  const level = parseLogLevel(env.BUN_DEV_INTEL_MCP_LOG_LEVEL);

  if (rawPath === undefined || rawPath.length === 0 || level === null || level === "NONE") {
    return { enabled: false, level: "NONE" };
  }

  if (!isAbsolute(rawPath)) {
    return { enabled: false, level: "NONE" };
  }

  return {
    enabled: true,
    level,
    filePath: resolve(rawPath)
  };
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function projectPathFromInput(input: unknown): string | null {
  if (!isRecord(input) || typeof input.projectPath !== "string" || input.projectPath.trim().length === 0) {
    return null;
  }

  return input.projectPath;
}

function pathIsInsideOrSame(parentPath: string, childPath: string): boolean {
  const relativePath = relative(resolve(parentPath), resolve(childPath));
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function shouldSkipForProjectSafety(input: unknown, filePath: string): boolean {
  const projectPath = projectPathFromInput(input);

  if (projectPath === null) {
    return false;
  }

  return pathIsInsideOrSame(projectPath, filePath);
}

function summarizeScalar(value: unknown): unknown {
  if (typeof value === "string") {
    return {
      type: "string",
      length: value.length
    };
  }

  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return {
      type: value === null ? "null" : typeof value,
      value
    };
  }

  return null;
}

function summarizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return {
      type: "array",
      length: value.length
    };
  }

  if (isRecord(value)) {
    const entries = Object.entries(value);
    const scalarFields: Record<string, unknown> = {};

    for (const [key, fieldValue] of entries) {
      const summary = summarizeScalar(fieldValue);

      if (summary !== null) {
        scalarFields[key] = summary;
      }
    }

    return {
      type: "object",
      keys: entries.map(([key]) => key),
      ...(Object.keys(scalarFields).length === 0 ? {} : { scalarFields })
    };
  }

  return summarizeScalar(value) ?? { type: typeof value };
}

function countArrayField(value: unknown, key: string): number | undefined {
  if (!isRecord(value) || !Array.isArray(value[key])) {
    return undefined;
  }

  return value[key].length;
}

function summarizeResult(result: unknown): unknown {
  if (!isRecord(result)) {
    return summarizeValue(result);
  }

  return {
    type: "object",
    keys: Object.keys(result),
    ...(typeof result.ok === "boolean" ? { ok: result.ok } : {}),
    ...(typeof result.cacheStatus === "string" ? { cacheStatus: result.cacheStatus } : {}),
    ...(typeof result.confidence === "string" ? { confidence: result.confidence } : {}),
    ...(countArrayField(result, "warnings") === undefined ? {} : { warningCount: countArrayField(result, "warnings") }),
    ...(countArrayField(result, "recommendations") === undefined
      ? {}
      : { recommendationCount: countArrayField(result, "recommendations") }),
    ...(countArrayField(result, "sources") === undefined ? {} : { sourceCount: countArrayField(result, "sources") }),
    ...(countArrayField(result, "results") === undefined ? {} : { resultCount: countArrayField(result, "results") })
  };
}

function sanitizeError(error: unknown): JsonObject {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message
    };
  }

  if (isRecord(error)) {
    return {
      name: typeof error.name === "string" ? error.name : "Error",
      message: typeof error.message === "string" ? error.message : "Internal server error"
    };
  }

  if (typeof error === "string" && error.length > 0) {
    return {
      name: "Error",
      message: error
    };
  }

  return {
    name: "Error",
    message: "Internal server error"
  };
}

class FileAuditLogger implements AuditLogger {
  readonly enabled: boolean;
  readonly level: AuditLogLevel;
  private readonly filePath: string | undefined;
  private readonly now: () => string;
  private readonly appendFile: (filePath: string, data: string) => void;

  constructor(config: AuditLogConfig, options: Required<Pick<CreateAuditLoggerOptions, "now" | "appendFile">>) {
    this.enabled = config.enabled;
    this.level = config.level;
    this.filePath = config.filePath;
    this.now = options.now;
    this.appendFile = options.appendFile;
  }

  logToolCallStart(event: ToolCallStartAuditEventInput): void {
    this.write(event.input, {
      timestamp: this.now(),
      event: "tool_call_start",
      toolName: event.toolName,
      level: this.level,
      ...(this.level === "DEBUG" ? { inputSummary: summarizeValue(event.input) } : {}),
      ...(this.level === "TRACE" ? { input: event.input } : {})
    });
  }

  logToolCallEnd(event: ToolCallEndAuditEventInput): void {
    this.write(event.input, {
      timestamp: this.now(),
      event: "tool_call_end",
      toolName: event.toolName,
      level: this.level,
      status: event.status,
      durationMs: event.durationMs,
      ...(this.level === "DEBUG" && event.result !== undefined ? { resultSummary: summarizeResult(event.result) } : {}),
      ...(this.level === "DEBUG" && event.error !== undefined ? { error: sanitizeError(event.error) } : {}),
      ...(this.level === "TRACE" ? { input: event.input } : {}),
      ...(this.level === "TRACE" && event.result !== undefined ? { result: event.result } : {}),
      ...(this.level === "TRACE" && event.error !== undefined ? { error: sanitizeError(event.error) } : {})
    });
  }

  private write(input: unknown, event: JsonObject): void {
    if (!this.enabled || this.filePath === undefined || shouldSkipForProjectSafety(input, this.filePath)) {
      return;
    }

    try {
      this.appendFile(this.filePath, `${JSON.stringify(event)}\n`);
    } catch {
      // Audit logging must never fail an MCP tool call.
    }
  }
}

export function createAuditLogger(options: CreateAuditLoggerOptions = {}): AuditLogger {
  return new FileAuditLogger(parseAuditLogConfig(options.env), {
    now: options.now ?? (() => new Date().toISOString()),
    appendFile: options.appendFile ?? appendFileSync
  });
}
