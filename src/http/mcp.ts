import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import type { Context } from "hono";
import { createRemoteDocsMcpServer, type ServerDependencies } from "../server";
import type { McpHttpHandler } from "./app";

export interface ConnectableMcpServer {
  readonly connect: (transport: StreamableHttpTransport) => Promise<void> | void;
}

export interface StreamableHttpTransport {
  onerror?: (error: Error) => void;
  readonly start: () => Promise<void>;
  readonly send: (...args: unknown[]) => Promise<void>;
  readonly close: () => Promise<void>;
  readonly handleRequest: (request: Request) => Promise<Response> | Response;
}

export interface RemoteDocsMcpHandlerOptions {
  readonly dependencies?: ServerDependencies;
  readonly createServer?: () => ConnectableMcpServer;
  readonly createTransport?: () => StreamableHttpTransport;
  readonly onTransportError?: (error: Error) => void;
}

function createDefaultTransport(): StreamableHttpTransport {
  return new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
    sessionIdGenerator: undefined
  }) as StreamableHttpTransport;
}

export function createRemoteDocsMcpHandler(options: RemoteDocsMcpHandlerOptions = {}): McpHttpHandler {
  const server: ConnectableMcpServer =
    options.createServer?.() ??
    createRemoteDocsMcpServer({
      ...(options.dependencies === undefined ? {} : { dependencies: options.dependencies })
    });
  const transport = options.createTransport?.() ?? createDefaultTransport();
  let connectPromise: Promise<void> | undefined;

  if (options.onTransportError !== undefined) {
    transport.onerror = options.onTransportError;
  }

  async function ensureConnected(): Promise<void> {
    connectPromise ??= Promise.resolve(server.connect(transport));
    await connectPromise;
  }

  return async (context: Context) => {
    await ensureConnected();
    return transport.handleRequest(context.req.raw);
  };
}
