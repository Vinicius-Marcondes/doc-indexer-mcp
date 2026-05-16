export * from "../apps/docs-worker/src/index";
import { startDocsWorker } from "../apps/docs-worker/src/index";

if (import.meta.main) {
  const result = await startDocsWorker();

  if (!result.ok) {
    process.stderr.write(`bun-dev-intel-mcp docs worker failed: ${result.error.message}\n`);
    process.exit(1);
  }

  process.stderr.write(
    `bun-dev-intel-mcp docs worker processed ${result.result.processed} refresh jobs ` +
      `(${result.result.succeeded} succeeded, ${result.result.failed} failed)\n`
  );
}
