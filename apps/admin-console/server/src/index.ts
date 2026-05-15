import { createAdminConsoleApp } from "./app";
import { startAdminConsoleServer } from "./runtime";

if (import.meta.main) {
  const result = await startAdminConsoleServer();

  if (!result.ok) {
    process.stderr.write(`bun-dev-intel-admin-console startup failed: ${result.error.message}\n`);

    for (const issue of result.error.issues ?? []) {
      process.stderr.write(`- ${issue.path}: ${issue.message}\n`);
    }

    process.exit(1);
  }

  process.stderr.write(`bun-dev-intel-admin-console listening on ${result.host}:${result.port}\n`);
}

export { createAdminConsoleApp, startAdminConsoleServer };
export {
  parseAdminRuntimeConfig,
  createAdminRuntimeApp,
  SearchDocsAdminSearchService
} from "./runtime";
