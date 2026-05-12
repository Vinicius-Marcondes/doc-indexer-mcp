import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Context } from "hono";
import { helper } from "./util";

export function start() {
  const db = new Database(":memory:");
  const file = Bun.file(join(import.meta.dir, "fixture.txt"));

  Bun.write("/tmp/bun-dev-intel-fixture.txt", "fixture");
  Bun.spawn(["bun", "--version"]);

  return Bun.serve({
    port: 0,
    fetch() {
      return new Response(`${helper()} ${db.filename} ${file.name} ${readFileSync}`);
    }
  });
}

export function readEnv(context: Context) {
  return `${Bun.env.NODE_ENV ?? "test"} ${context.req.path}`;
}
