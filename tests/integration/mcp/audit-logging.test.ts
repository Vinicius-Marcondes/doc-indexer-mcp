import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  createServerDependencies,
  registerBunDevIntelCapabilities,
  type ServerDependencies
} from "../../../src/server";

const tempDirs: string[] = [];

class RecordingRegistrar {
  readonly tools: Array<{ name: string; config: Record<string, unknown>; handler: (input: unknown) => unknown }> = [];
  readonly resources: Array<{ name: string; config: Record<string, unknown>; handler: unknown }> = [];

  registerTool(name: string, config: Record<string, unknown>, handler: (input: unknown) => unknown): void {
    this.tools.push({ name, config, handler });
  }

  registerResource(name: string, _uriOrTemplate: unknown, config: Record<string, unknown>, handler: unknown): void {
    this.resources.push({ name, config, handler });
  }
}

function tempDir(): string {
  const dir = mkdtempSync(resolve(tmpdir(), "bun-dev-intel-audit-integration-"));
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

function fixturePath(name: string): string {
  return resolve(process.cwd(), "tests", "fixtures", "projects", name);
}

function registerWithAudit(logPath: string, level: string, overrides: Partial<ServerDependencies> = {}): RecordingRegistrar {
  const registrar = new RecordingRegistrar();
  const dependencies = {
    ...createServerDependencies({
      cachePath: resolve(tempDir(), "cache.sqlite"),
      fetchImpl: async () => new Response("", { status: 200 }),
      now: () => "2026-05-12T10:00:00.000Z",
      env: {
        BUN_DEV_INTEL_MCP_AUDIT_LOG: logPath,
        BUN_DEV_INTEL_MCP_LOG_LEVEL: level
      }
    }),
    ...overrides
  };

  registerBunDevIntelCapabilities(registrar, dependencies);
  return registrar;
}

function getTool(registrar: RecordingRegistrar, name: string): (input: unknown) => Promise<unknown> {
  const tool = registrar.tools.find((registeredTool) => registeredTool.name === name);

  if (tool === undefined) {
    throw new Error(`Missing registered tool: ${name}`);
  }

  return async (input: unknown) => tool.handler(input) as Promise<unknown>;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("MCP audit logging integration", () => {
  test("registered tool calls emit start and end events at INFO level", async () => {
    const logPath = resolve(tempDir(), "audit.jsonl");
    const registrar = registerWithAudit(logPath, "INFO");
    const reviewProject = getTool(registrar, "review_bun_project");

    const result = await reviewProject({ projectPath: fixturePath("minimal-bun-ts") });
    const events = readJsonl(logPath);

    expect(result).toHaveProperty("structuredContent");
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.event)).toEqual(["tool_call_start", "tool_call_end"]);
    expect(events.map((event) => event.toolName)).toEqual(["review_bun_project", "review_bun_project"]);
    expect(events[1]).toMatchObject({
      level: "INFO",
      status: "ok"
    });
    expect(events[1]?.durationMs).toBeNumber();
  });

  test("thrown tool handler failures are logged as sanitized errors", async () => {
    const logPath = resolve(tempDir(), "audit.jsonl");
    const baseDependencies = createServerDependencies({
      cachePath: resolve(tempDir(), "cache.sqlite"),
      fetchImpl: async () => new Response("", { status: 200 }),
      now: () => "2026-05-12T10:00:00.000Z",
      env: {
        BUN_DEV_INTEL_MCP_AUDIT_LOG: logPath,
        BUN_DEV_INTEL_MCP_LOG_LEVEL: "TRACE"
      }
    });
    const registrar = new RecordingRegistrar();

    registerBunDevIntelCapabilities(registrar, {
      ...baseDependencies,
      docsRetrieval: {
        search: async () => {
          throw new Error("retrieval exploded");
        }
      } as unknown as ServerDependencies["docsRetrieval"]
    });

    const searchDocs = getTool(registrar, "search_bun_docs");

    await expect(searchDocs({ query: "typescript" })).rejects.toThrow("retrieval exploded");

    const events = readJsonl(logPath);
    const endEvent = events.find((event) => event.event === "tool_call_end");

    expect(endEvent).toMatchObject({
      toolName: "search_bun_docs",
      status: "error",
      error: {
        name: "Error",
        message: "retrieval exploded"
      }
    });
    expect(JSON.stringify(endEvent)).not.toContain("stack");
  });

  test("audit path inside projectPath is skipped for registered tool calls", async () => {
    const projectPath = fixturePath("minimal-bun-ts");
    const logPath = resolve(projectPath, "audit.jsonl");
    const registrar = registerWithAudit(logPath, "TRACE");
    const reviewProject = getTool(registrar, "review_bun_project");

    await reviewProject({ projectPath });

    expect(readJsonl(logPath)).toEqual([]);
  });

  test("audit file write failures do not fail registered tool calls", async () => {
    const logPath = tempDir();
    const registrar = registerWithAudit(logPath, "INFO");
    const reviewProject = getTool(registrar, "review_bun_project");

    await expect(reviewProject({ projectPath: fixturePath("minimal-bun-ts") })).resolves.toHaveProperty(
      "structuredContent"
    );
  });
});
