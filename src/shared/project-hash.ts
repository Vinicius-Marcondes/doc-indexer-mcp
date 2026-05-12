import { createHash } from "node:crypto";

export function hashProjectPath(projectPath: string): string {
  return createHash("sha256").update(projectPath).digest("hex");
}

export function isProjectHash(value: string): boolean {
  return /^[a-f0-9]{64}$/u.test(value);
}
