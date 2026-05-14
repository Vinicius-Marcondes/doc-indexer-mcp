import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  createBunDevIntelServer,
  createServerDependencies,
  getRemoteDocsCapabilityManifest,
  getServerCapabilityManifest,
  registerBunDevIntelCapabilities,
  registerRemoteDocsCapabilities,
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
      "project_health",
      "check_before_install",
      "check_bun_api_usage",
      "lint_bun_file",
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
      "bun-project-analysis",
      "bun-project-findings"
    ]);
  });

  test("tool schemas match expected input contracts", () => {
    const manifest = getServerCapabilityManifest();

    expect(manifest.tools.map((tool) => [tool.name, standardSchemaInputKeys(tool.inputSchema)])).toEqual([
      ["project_health", ["projectPath", "focus", "responseMode", "sinceToken", "forceRefresh"]],
      ["check_before_install", ["projectPath", "packages", "dependencyType", "responseMode", "forceRefresh"]],
      ["check_bun_api_usage", ["apiName", "projectPath", "usageSnippet", "agentTrainingCutoff", "responseMode", "forceRefresh"]],
      ["lint_bun_file", ["projectPath", "filePath", "responseMode"]],
      ["analyze_bun_project", ["projectPath", "forceRefresh"]],
      ["search_bun_docs", ["query", "topic", "limit", "forceRefresh"]],
      ["get_bun_best_practices", ["topic", "projectPath", "forceRefresh"]],
      ["plan_bun_dependency", ["projectPath", "packages", "dependencyType", "responseMode"]],
      ["review_bun_project", ["projectPath", "focus", "responseMode"]]
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

    expect(manifest.tools.find((tool) => tool.name === "project_health")?.description).toContain("brief");
    expect(manifest.tools.find((tool) => tool.name === "check_before_install")?.description).toContain("before");
  });

  test("remote docs manifest can be built without DB or network startup", () => {
    const manifest = getRemoteDocsCapabilityManifest();

    expect(manifest.tools.map((tool) => tool.name)).toEqual(["search_docs", "get_doc_page", "search_bun_docs"]);
    expect(manifest.resources.map((resource) => resource.name)).toEqual([
      "docs-sources",
      "docs-page",
      "docs-chunk",
      "bun-docs-index",
      "bun-docs-page"
    ]);
  });

  test("remote docs manifest excludes project path inputs and local project resources", () => {
    const manifest = getRemoteDocsCapabilityManifest();

    for (const tool of manifest.tools) {
      expect(standardSchemaInputKeys(tool.inputSchema)).not.toContain("projectPath");
    }

    expect(manifest.resources.map((resource) => resource.name)).not.toContain("bun-project-analysis");
    expect(manifest.resources.map((resource) => resource.name)).not.toContain("bun-project-findings");
  });

  test("remote docs registration is docs-only and does not fetch at registration time", () => {
    const registrar = new RecordingRegistrar();
    let fetchCount = 0;

    registerRemoteDocsCapabilities(
      registrar,
      createServerDependencies({
        cachePath: tempCachePath(),
        fetchImpl: async () => {
          fetchCount += 1;
          return new Response("", { status: 200 });
        },
        now: () => "2026-05-12T10:00:00.000Z"
      })
    );

    expect(fetchCount).toBe(0);
    expect(registrar.tools.map((tool) => tool.name)).toEqual(["search_docs", "get_doc_page", "search_bun_docs"]);
    expect(registrar.resources.map((resource) => resource.name)).toEqual([
      "docs-sources",
      "docs-page",
      "docs-chunk",
      "bun-docs-index",
      "bun-docs-page"
    ]);
  });
});
