import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  createBunDevIntelServer,
  createServerDependencies,
  getServerCapabilityManifest,
  registerBunDevIntelCapabilities,
  serverMetadata
} from "../../../src/server";

const tempDirs: string[] = [];

class RecordingRegistrar {
  readonly tools: Array<{ name: string; config: Record<string, unknown>; handler: unknown }> = [];
  readonly resources: Array<{ name: string; config: Record<string, unknown>; handler: unknown }> = [];

  registerTool(name: string, config: Record<string, unknown>, handler: unknown): void {
    this.tools.push({ name, config, handler });
  }

  registerResource(name: string, _uriOrTemplate: unknown, config: Record<string, unknown>, handler: unknown): void {
    this.resources.push({ name, config, handler });
  }
}

interface StandardSchemaInput {
  readonly "~standard"?: {
    readonly jsonSchema?: {
      readonly input?: () => {
        readonly properties?: Record<string, unknown>;
      };
    };
  };
}

function standardSchemaInputKeys(schema: unknown): string[] {
  const jsonSchema = (schema as StandardSchemaInput)["~standard"]?.jsonSchema?.input?.();
  return Object.keys(jsonSchema?.properties ?? {});
}

function tempCachePath(): string {
  const dir = mkdtempSync(resolve(tmpdir(), "bun-dev-intel-server-registration-"));
  tempDirs.push(dir);
  return resolve(dir, "cache.sqlite");
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("MCP server registration", () => {
  test("server can be constructed", () => {
    const server = createBunDevIntelServer({
      dependencies: createServerDependencies({
        cachePath: tempCachePath(),
        fetchImpl: async () => new Response("", { status: 200 }),
        now: () => "2026-05-12T10:00:00.000Z"
      })
    });

    expect(server).toBeDefined();
    expect(serverMetadata).toEqual({
      name: "bun-dev-intel-mcp",
      version: "0.1.0"
    });
  });

  test("required tools are registered", () => {
    const registrar = new RecordingRegistrar();
    registerBunDevIntelCapabilities(
      registrar,
      createServerDependencies({
        cachePath: tempCachePath(),
        fetchImpl: async () => new Response("", { status: 200 }),
        now: () => "2026-05-12T10:00:00.000Z"
      })
    );

    expect(registrar.tools.map((tool) => tool.name)).toEqual([
      "analyze_bun_project",
      "search_bun_docs",
      "get_bun_best_practices",
      "plan_bun_dependency",
      "review_bun_project"
    ]);
  });

  test("required resources are registered", () => {
    const registrar = new RecordingRegistrar();
    registerBunDevIntelCapabilities(
      registrar,
      createServerDependencies({
        cachePath: tempCachePath(),
        fetchImpl: async () => new Response("", { status: 200 }),
        now: () => "2026-05-12T10:00:00.000Z"
      })
    );

    expect(registrar.resources.map((resource) => resource.name)).toEqual([
      "bun-docs-index",
      "bun-docs-page",
      "bun-project-analysis"
    ]);
  });

  test("tool schemas match expected input contracts", () => {
    const manifest = getServerCapabilityManifest();

    expect(manifest.tools.map((tool) => [tool.name, standardSchemaInputKeys(tool.inputSchema)])).toEqual([
      ["analyze_bun_project", ["projectPath", "forceRefresh"]],
      ["search_bun_docs", ["query", "topic", "forceRefresh"]],
      ["get_bun_best_practices", ["topic", "projectPath", "forceRefresh"]],
      ["plan_bun_dependency", ["projectPath", "packages", "dependencyType"]],
      ["review_bun_project", ["projectPath", "focus"]]
    ]);
  });

  test("registered tool schemas are Standard Schema-compatible for the MCP SDK", () => {
    const registrar = new RecordingRegistrar();
    registerBunDevIntelCapabilities(
      registrar,
      createServerDependencies({
        cachePath: tempCachePath(),
        fetchImpl: async () => new Response("", { status: 200 }),
        now: () => "2026-05-12T10:00:00.000Z"
      })
    );

    for (const tool of registrar.tools) {
      const schema = tool.config.inputSchema as StandardSchemaInput;
      expect(schema["~standard"]?.jsonSchema?.input).toBeTypeOf("function");
    }
  });

  test("tool descriptions are present and concise", () => {
    const manifest = getServerCapabilityManifest();

    for (const tool of manifest.tools) {
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.description.length).toBeLessThanOrEqual(160);
    }
  });
});
