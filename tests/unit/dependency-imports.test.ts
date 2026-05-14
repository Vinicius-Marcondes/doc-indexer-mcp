import { describe, expect, test } from "bun:test";
import { WebStandardStreamableHTTPServerTransport, McpServer } from "@modelcontextprotocol/server";
import * as mcpHono from "@modelcontextprotocol/hono";
import { Hono } from "hono";
import OpenAI from "openai";
import postgres from "postgres";

describe("remote docs dependency imports", () => {
  test("selected MCP server imports compile", () => {
    expect(typeof McpServer).toBe("function");
    expect(typeof WebStandardStreamableHTTPServerTransport).toBe("function");
  });

  test("selected Hono imports compile", () => {
    expect(typeof Hono).toBe("function");
    expect(typeof mcpHono).toBe("object");
  });

  test("selected Postgres and embedding provider imports compile", () => {
    expect(typeof postgres).toBe("function");
    expect(typeof OpenAI).toBe("function");
  });
});
