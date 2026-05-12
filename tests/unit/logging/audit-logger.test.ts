import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createAuditLogger, parseAuditLogConfig } from "../../../src/logging/audit-logger";

const tempDirs: string[] = [];
const timestamp = "2026-05-12T10:00:00.000Z";

function tempDir(): string {
  const dir = mkdtempSync(resolve(tmpdir(), "bun-dev-intel-audit-logger-"));
  tempDirs.push(dir);
  return dir;
}

function readJsonl(filePath: string): Array<Record<string, unknown>> {
  if (!existsSync(filePath)) {
    return [];
  }

  const content = readFileSync(filePath, "utf8").trim();

  if (content.length === 0) {
    return [];
  }

  return content.split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("audit logger configuration", () => {
  test("missing audit log path disables logging", () => {
    const config = parseAuditLogConfig({});

    expect(config.enabled).toBe(false);
    expect(config.level).toBe("NONE");
  });

  test("missing log level defaults to NONE even when a path is configured", () => {
    const logPath = resolve(tempDir(), "audit.jsonl");
    const logger = createAuditLogger({
      env: { BUN_DEV_INTEL_MCP_AUDIT_LOG: logPath },
      now: () => timestamp
    });

    logger.logToolCallStart({ toolName: "review_bun_project", input: {} });

    expect(logger.enabled).toBe(false);
    expect(readJsonl(logPath)).toEqual([]);
  });

  test("invalid log level disables logging", () => {
    const logPath = resolve(tempDir(), "audit.jsonl");
    const logger = createAuditLogger({
      env: {
        BUN_DEV_INTEL_MCP_AUDIT_LOG: logPath,
        BUN_DEV_INTEL_MCP_LOG_LEVEL: "VERBOSE"
      },
      now: () => timestamp
    });

    logger.logToolCallStart({ toolName: "review_bun_project", input: {} });

    expect(logger.enabled).toBe(false);
    expect(readJsonl(logPath)).toEqual([]);
  });

  test("relative audit log paths are rejected", () => {
    const logger = createAuditLogger({
      env: {
        BUN_DEV_INTEL_MCP_AUDIT_LOG: "audit.jsonl",
        BUN_DEV_INTEL_MCP_LOG_LEVEL: "INFO"
      },
      now: () => timestamp
    });

    logger.logToolCallStart({ toolName: "review_bun_project", input: {} });

    expect(logger.enabled).toBe(false);
  });
});

describe("audit log levels", () => {
  test("NONE writes no events", () => {
    const logPath = resolve(tempDir(), "audit.jsonl");
    const logger = createAuditLogger({
      env: {
        BUN_DEV_INTEL_MCP_AUDIT_LOG: logPath,
        BUN_DEV_INTEL_MCP_LOG_LEVEL: "NONE"
      },
      now: () => timestamp
    });

    logger.logToolCallStart({ toolName: "review_bun_project", input: { projectPath: "/tmp/project" } });

    expect(readJsonl(logPath)).toEqual([]);
  });

  test("INFO writes usage metadata only", () => {
    const logPath = resolve(tempDir(), "audit.jsonl");
    const logger = createAuditLogger({
      env: {
        BUN_DEV_INTEL_MCP_AUDIT_LOG: logPath,
        BUN_DEV_INTEL_MCP_LOG_LEVEL: "INFO"
      },
      now: () => timestamp
    });

    const input = { projectPath: "/tmp/project", forceRefresh: true };
    logger.logToolCallStart({ toolName: "review_bun_project", input });
    logger.logToolCallEnd({
      toolName: "review_bun_project",
      input,
      status: "ok",
      durationMs: 12,
      result: { ok: true, recommendations: [{ id: "one" }] }
    });

    const events = readJsonl(logPath);

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({
      timestamp,
      event: "tool_call_start",
      toolName: "review_bun_project",
      level: "INFO"
    });
    expect(events[1]).toEqual({
      timestamp,
      event: "tool_call_end",
      toolName: "review_bun_project",
      level: "INFO",
      status: "ok",
      durationMs: 12
    });
    expect(events[0]).not.toHaveProperty("input");
    expect(events[1]).not.toHaveProperty("result");
  });

  test("DEBUG writes summaries without full payloads", () => {
    const logPath = resolve(tempDir(), "audit.jsonl");
    const logger = createAuditLogger({
      env: {
        BUN_DEV_INTEL_MCP_AUDIT_LOG: logPath,
        BUN_DEV_INTEL_MCP_LOG_LEVEL: "DEBUG"
      },
      now: () => timestamp
    });
    const input = {
      projectPath: "/tmp/private-project",
      packages: [{ name: "private-package", requestedRange: "^1.0.0" }]
    };
    const result = {
      ok: true,
      cacheStatus: "fresh",
      confidence: "high",
      warnings: [{ id: "warning" }],
      recommendations: [{ id: "recommendation" }]
    };

    logger.logToolCallStart({ toolName: "plan_bun_dependency", input });
    logger.logToolCallEnd({ toolName: "plan_bun_dependency", input, status: "ok", durationMs: 8, result });

    const events = readJsonl(logPath);

    expect(events[0]).toHaveProperty("inputSummary");
    expect(events[1]).toHaveProperty("resultSummary");
    expect(events[0]).not.toHaveProperty("input");
    expect(events[1]).not.toHaveProperty("result");
    expect(JSON.stringify(events)).not.toContain("/tmp/private-project");
    expect(JSON.stringify(events)).not.toContain("private-package");
    expect(events[1]?.resultSummary).toMatchObject({
      ok: true,
      cacheStatus: "fresh",
      confidence: "high",
      warningCount: 1,
      recommendationCount: 1
    });
  });

  test("TRACE writes full inputs, full results, and sanitized errors", () => {
    const logPath = resolve(tempDir(), "audit.jsonl");
    const logger = createAuditLogger({
      env: {
        BUN_DEV_INTEL_MCP_AUDIT_LOG: logPath,
        BUN_DEV_INTEL_MCP_LOG_LEVEL: "TRACE"
      },
      now: () => timestamp
    });
    const input = { query: "typescript" };
    const result = { ok: true, results: [{ title: "Bun TypeScript" }] };

    logger.logToolCallStart({ toolName: "search_bun_docs", input });
    logger.logToolCallEnd({ toolName: "search_bun_docs", input, status: "ok", durationMs: 4, result });
    logger.logToolCallEnd({
      toolName: "search_bun_docs",
      input,
      status: "error",
      durationMs: 5,
      error: new Error("adapter failed")
    });

    const events = readJsonl(logPath);

    expect(events[0]?.input).toEqual(input);
    expect(events[1]?.result).toEqual(result);
    expect(events[2]?.error).toEqual({
      name: "Error",
      message: "adapter failed"
    });
    expect(JSON.stringify(events[2])).not.toContain("stack");
  });
});

describe("audit logger safety", () => {
  test("skips writes when audit log path is inside the analyzed project", () => {
    const projectPath = tempDir();
    const logPath = resolve(projectPath, "audit.jsonl");
    const logger = createAuditLogger({
      env: {
        BUN_DEV_INTEL_MCP_AUDIT_LOG: logPath,
        BUN_DEV_INTEL_MCP_LOG_LEVEL: "TRACE"
      },
      now: () => timestamp
    });

    logger.logToolCallStart({ toolName: "review_bun_project", input: { projectPath } });
    logger.logToolCallEnd({
      toolName: "review_bun_project",
      input: { projectPath },
      status: "ok",
      durationMs: 1,
      result: { ok: true }
    });

    expect(readJsonl(logPath)).toEqual([]);
  });

  test("file write failures do not throw", () => {
    const logPath = tempDir();
    const logger = createAuditLogger({
      env: {
        BUN_DEV_INTEL_MCP_AUDIT_LOG: logPath,
        BUN_DEV_INTEL_MCP_LOG_LEVEL: "INFO"
      },
      now: () => timestamp
    });

    expect(() =>
      logger.logToolCallStart({ toolName: "review_bun_project", input: { projectPath: "/tmp/project" } })
    ).not.toThrow();
  });

  test("audit logging does not write to stdout", () => {
    const logPath = resolve(tempDir(), "audit.jsonl");
    const logger = createAuditLogger({
      env: {
        BUN_DEV_INTEL_MCP_AUDIT_LOG: logPath,
        BUN_DEV_INTEL_MCP_LOG_LEVEL: "INFO"
      },
      now: () => timestamp
    });
    const originalWrite = process.stdout.write;
    let stdoutWrites = 0;

    process.stdout.write = ((...args: Parameters<typeof process.stdout.write>) => {
      stdoutWrites += 1;
      return originalWrite.apply(process.stdout, args);
    }) as typeof process.stdout.write;

    try {
      logger.logToolCallStart({ toolName: "review_bun_project", input: {} });
    } finally {
      process.stdout.write = originalWrite;
    }

    expect(stdoutWrites).toBe(0);
  });
});
