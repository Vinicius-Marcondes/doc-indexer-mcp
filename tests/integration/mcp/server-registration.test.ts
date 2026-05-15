import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  createRemoteDocsMcpServer,
  createServerDependencies,
  getRemoteDocsCapabilityManifest,
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

describe("remote docs MCP server registration", () => {
  test("server can be constructed", () => {
    const server = createRemoteDocsMcpServer({
      dependencies: createServerDependencies({
        cachePath: tempCachePath(),
        fetchImpl: async () => new Response("", { status: 200 }),
        now: () => "2026-05-15T10:00:00.000Z"
      })
    });

    expect(server).toBeDefined();
    expect(serverMetadata).toEqual({
      name: "bun-dev-intel-mcp",
      version: "0.1.0"
    });
  });

  test("remote docs manifest exposes only HTTP-safe docs tools and resources", () => {
    const manifest = getRemoteDocsCapabilityManifest();

    expect(manifest.tools.map((tool) => tool.name)).toEqual(["search_docs", "get_doc_page", "search_bun_docs"]);
    expect(manifest.resources.map((resource) => resource.name)).toEqual([
      "docs-sources",
      "docs-page",
      "docs-chunk",
      "bun-docs-index",
      "bun-docs-page"
    ]);

    for (const tool of manifest.tools) {
      expect(standardSchemaInputKeys(tool.inputSchema)).not.toContain("projectPath");
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.description.length).toBeLessThanOrEqual(160);
    }
  });

  test("remote docs registration is side-effect-light and does not fetch at registration time", () => {
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
        now: () => "2026-05-15T10:00:00.000Z"
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

    for (const tool of registrar.tools) {
      const schema = tool.config.inputSchema as StandardSchemaInput;
      expect(schema["~standard"]?.jsonSchema?.input).toBeTypeOf("function");
    }
  });
});
