import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./packages/db/src/schema.ts",
  out: "./migrations/remote-docs",
  migrations: {
    table: "__drizzle_migrations",
    schema: "public"
  },
  strict: true,
  verbose: true
});
