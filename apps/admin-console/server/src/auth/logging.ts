export const adminAuthLogLevelValues = ["NONE", "INFO", "DEBUG", "TRACE"] as const;
export type AdminAuthLogLevel = (typeof adminAuthLogLevelValues)[number];

export type AdminAuthLogFields = Record<string, unknown>;

export interface AdminAuthLogger {
  readonly level: AdminAuthLogLevel;
  readonly info: (event: string, fields?: AdminAuthLogFields) => void;
  readonly debug: (event: string, fields?: AdminAuthLogFields) => void;
  readonly trace: (event: string, fields?: AdminAuthLogFields) => void;
}

export interface CreateStderrAdminAuthLoggerOptions {
  readonly level: AdminAuthLogLevel;
  readonly now?: () => string;
  readonly write?: (message: string) => void;
}

const levelRanks: Record<AdminAuthLogLevel, number> = {
  NONE: 0,
  INFO: 1,
  DEBUG: 2,
  TRACE: 3
};

export const noopAdminAuthLogger: AdminAuthLogger = {
  level: "NONE",
  info: () => undefined,
  debug: () => undefined,
  trace: () => undefined
};

export function parseAdminAuthLogLevel(value: string | undefined, defaultLevel: AdminAuthLogLevel = "INFO"): AdminAuthLogLevel | null {
  if (value === undefined || value.trim().length === 0) {
    return defaultLevel;
  }

  const normalized = value.trim().toUpperCase();

  if (adminAuthLogLevelValues.includes(normalized as AdminAuthLogLevel)) {
    return normalized as AdminAuthLogLevel;
  }

  return null;
}

function shouldWrite(configuredLevel: AdminAuthLogLevel, eventLevel: Exclude<AdminAuthLogLevel, "NONE">): boolean {
  return levelRanks[configuredLevel] >= levelRanks[eventLevel];
}

export function createStderrAdminAuthLogger(options: CreateStderrAdminAuthLoggerOptions): AdminAuthLogger {
  const now = options.now ?? (() => new Date().toISOString());
  const write = options.write ?? ((message: string) => process.stderr.write(message));

  function emit(level: Exclude<AdminAuthLogLevel, "NONE">, event: string, fields: AdminAuthLogFields = {}): void {
    if (!shouldWrite(options.level, level)) {
      return;
    }

    try {
      write(
        `${JSON.stringify({
          timestamp: now(),
          level,
          component: "admin.auth",
          event,
          ...fields
        })}\n`
      );
    } catch {
      // Diagnostic logging must never break the auth flow.
    }
  }

  return {
    level: options.level,
    info: (event, fields) => emit("INFO", event, fields),
    debug: (event, fields) => emit("DEBUG", event, fields),
    trace: (event, fields) => emit("TRACE", event, fields)
  };
}
