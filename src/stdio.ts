import type { Readable, Writable } from "node:stream";
import { createBunDevIntelServer } from "./server";
import { createStructuredError, type StructuredError } from "./shared/errors";

export interface ConnectableServer {
  readonly connect: (transport: LocalStdioServerTransport | unknown) => Promise<void> | void;
}

export interface StderrLike {
  readonly write: (message: string) => unknown;
}

export interface StartStdioServerOptions {
  readonly createServer?: () => ConnectableServer;
  readonly createTransport?: () => unknown;
  readonly stderr?: StderrLike;
}

export interface StartStdioServerSuccess {
  readonly ok: true;
}

export interface StartStdioServerFailure {
  readonly ok: false;
  readonly error: StructuredError;
}

export type StartStdioServerResult = StartStdioServerSuccess | StartStdioServerFailure;

export interface LocalStdioServerTransportOptions {
  readonly stdin?: Readable;
  readonly stdout?: Writable;
}

export class LocalStdioServerTransport {
  private buffer = "";
  private started = false;
  private closed = false;
  private readonly stdin: Readable;
  private readonly stdout: Writable;

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: unknown) => void;

  constructor(options: LocalStdioServerTransportOptions = {}) {
    this.stdin = options.stdin ?? process.stdin;
    this.stdout = options.stdout ?? process.stdout;
  }

  private readonly onData = (chunk: Buffer | string): void => {
    this.buffer += chunk.toString();
    this.processBuffer();
  };

  private readonly onError = (error: Error): void => {
    this.onerror?.(error);
  };

  private processBuffer(): void {
    while (true) {
      const newlineIndex = this.buffer.indexOf("\n");

      if (newlineIndex === -1) {
        return;
      }

      const line = this.buffer.slice(0, newlineIndex).replace(/\r$/u, "");
      this.buffer = this.buffer.slice(newlineIndex + 1);

      if (line.trim().length === 0) {
        continue;
      }

      try {
        this.onmessage?.(JSON.parse(line) as unknown);
      } catch (error) {
        this.onerror?.(error instanceof Error ? error : new Error("Invalid JSON-RPC message"));
      }
    }
  }

  async start(): Promise<void> {
    if (this.started) {
      throw new Error("LocalStdioServerTransport already started.");
    }

    this.started = true;
    this.stdin.on("data", this.onData);
    this.stdin.on("error", this.onError);
    this.stdout.on("error", this.onError);
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.stdin.off("data", this.onData);
    this.stdin.off("error", this.onError);
    this.stdout.off("error", this.onError);
    this.buffer = "";

    if (this.stdin.listenerCount("data") === 0) {
      this.stdin.pause();
    }

    this.onclose?.();
  }

  send(message: unknown): Promise<void> {
    if (this.closed) {
      return Promise.reject(new Error("LocalStdioServerTransport is closed."));
    }

    return new Promise((resolve, reject) => {
      const payload = `${JSON.stringify(message)}\n`;
      const onError = (error: Error): void => {
        this.stdout.off("error", onError);
        this.stdout.off("drain", onDrain);
        reject(error);
      };
      const onDrain = (): void => {
        this.stdout.off("error", onError);
        resolve();
      };

      this.stdout.once("error", onError);

      if (this.stdout.write(payload)) {
        this.stdout.off("error", onError);
        resolve();
      } else {
        this.stdout.once("drain", onDrain);
      }
    });
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  return "unknown startup failure";
}

export async function startStdioServer(options: StartStdioServerOptions = {}): Promise<StartStdioServerResult> {
  try {
    const server: ConnectableServer =
      options.createServer?.() ?? (createBunDevIntelServer() as unknown as ConnectableServer);
    const transport = options.createTransport?.() ?? new LocalStdioServerTransport();

    await server.connect(transport);

    return { ok: true };
  } catch (error) {
    const message = errorMessage(error);
    const stderr = options.stderr ?? process.stderr;

    stderr.write(`bun-dev-intel-mcp startup failed: ${message}\n`);

    return {
      ok: false,
      error: createStructuredError("internal_error", "MCP stdio server failed to start.", {
        reason: message
      })
    };
  }
}

if (import.meta.main) {
  const result = await startStdioServer();

  if (!result.ok) {
    process.exit(1);
  }
}
