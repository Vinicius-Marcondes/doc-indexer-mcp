import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createBunDevIntelServer, createServerDependencies } from "../../../src/server";
import { startStdioServer } from "../../../src/stdio";

describe("stdio entrypoint", () => {
  test("entrypoint imports without side effects when tested", async () => {
    const module = await import("../../../src/stdio");

    expect(module.startStdioServer).toBeTypeOf("function");
  });

  test("server connects to mocked stdio transport", async () => {
    const transport = { kind: "mock-stdio" };
    const connected: unknown[] = [];
    const result = await startStdioServer({
      createServer: () => ({
        connect: async (receivedTransport: unknown) => {
          connected.push(receivedTransport);
        }
      }),
      createTransport: () => transport
    });

    expect(result.ok).toBe(true);
    expect(connected).toEqual([transport]);
  });

  test("startup failure reports error safely", async () => {
    const stderr: string[] = [];
    const result = await startStdioServer({
      createServer: () => ({
        connect: async () => {
          throw new Error("transport unavailable");
        }
      }),
      createTransport: () => ({ kind: "mock-stdio" }),
      stderr: {
        write: (message: string) => {
          stderr.push(message);
          return true;
        }
      }
    });

    expect(result.ok).toBe(false);
    expect(stderr.join("")).toContain("bun-dev-intel-mcp startup failed: transport unavailable");
    expect(stderr.join("")).not.toContain("at ");
  });

  test("no analysis or network fetch occurs at startup", async () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), "bun-dev-intel-stdio-"));
    let fetchCount = 0;

    try {
      const result = await startStdioServer({
        createServer: () => {
          createBunDevIntelServer({
            dependencies: createServerDependencies({
              cachePath: resolve(tempDir, "cache.sqlite"),
              fetchImpl: async () => {
                fetchCount += 1;
                return new Response("", { status: 200 });
              },
              now: () => "2026-05-12T10:00:00.000Z"
            })
          });

          return {
            connect: async () => undefined
          };
        },
        createTransport: () => ({ kind: "mock-stdio" })
      });

      expect(result.ok).toBe(true);
      expect(fetchCount).toBe(0);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
