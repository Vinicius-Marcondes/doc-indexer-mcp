export * from "../apps/mcp-http/src/index";
import { startRemoteHttpServer } from "../apps/mcp-http/src/index";

if (import.meta.main) {
  const result = startRemoteHttpServer();

  if (!result.ok) {
    process.stderr.write(`bun-dev-intel-mcp http startup failed: ${result.error.message}\n`);
    process.exit(1);
  }

  process.stderr.write(`bun-dev-intel-mcp http listening on ${result.host}:${result.port}\n`);
}
