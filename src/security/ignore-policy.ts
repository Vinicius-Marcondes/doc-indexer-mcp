import { readFileSync } from "node:fs";
import { basename, extname, normalize } from "node:path";

export type IgnoreReason = "ignored_directory" | "secret_file" | "binary_file";

export interface IgnoreDecision {
  readonly ignored: boolean;
  readonly reason?: IgnoreReason;
  readonly label?: string;
}

export interface ReadAllowedTextResult {
  readonly ok: true;
  readonly content: string;
}

export interface ReadSkippedResult {
  readonly ok: false;
  readonly skipped: IgnoreDecision & { readonly ignored: true };
}

export type ReadTextResult = ReadAllowedTextResult | ReadSkippedResult;

export const ignoredDirectoryNames = [
  "node_modules",
  ".git",
  "dist",
  "build",
  ".cache",
  "coverage",
  ".turbo",
  ".next",
  ".expo"
] as const;

export const ignoredSecretFileNames = [
  ".env",
  ".env.local",
  ".env.production",
  "credentials.json",
  "private.key",
  "id_rsa",
  "id_dsa"
] as const;

const ignoredDirectorySet = new Set<string>(ignoredDirectoryNames);
const ignoredSecretFileSet = new Set<string>(ignoredSecretFileNames);
const binaryExtensions = new Set([
  ".lockb",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".pdf",
  ".zip",
  ".gz",
  ".tgz",
  ".tar",
  ".wasm",
  ".node",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".sqlite",
  ".db"
]);

function pathSegments(path: string): string[] {
  return normalize(path).split(/[\\/]+/).filter(Boolean);
}

function ignoredDirectoryIn(path: string): string | undefined {
  return pathSegments(path).find((segment) => ignoredDirectorySet.has(segment));
}

function isSecretFile(fileName: string): boolean {
  return (
    ignoredSecretFileSet.has(fileName) ||
    fileName.endsWith(".pem") ||
    fileName.endsWith(".p12") ||
    fileName.endsWith(".pfx") ||
    fileName.toLowerCase().includes("credential")
  );
}

function isBinaryLookingFile(fileName: string): boolean {
  return binaryExtensions.has(extname(fileName).toLowerCase());
}

export function shouldIgnorePath(path: string, kind: "file" | "directory"): IgnoreDecision {
  const directoryLabel = ignoredDirectoryIn(path);

  if (directoryLabel !== undefined) {
    return {
      ignored: true,
      reason: "ignored_directory",
      label: directoryLabel
    };
  }

  if (kind === "directory") {
    return { ignored: false };
  }

  const fileName = basename(path);

  if (isSecretFile(fileName)) {
    return {
      ignored: true,
      reason: "secret_file",
      label: fileName
    };
  }

  if (isBinaryLookingFile(fileName)) {
    return {
      ignored: true,
      reason: "binary_file",
      label: fileName
    };
  }

  return { ignored: false };
}

export function readTextFileIfAllowed(
  path: string,
  reader: (path: string) => string = (allowedPath) => readFileSync(allowedPath, "utf8")
): ReadTextResult {
  const decision = shouldIgnorePath(path, "file");

  if (decision.ignored) {
    return {
      ok: false,
      skipped: decision as IgnoreDecision & { readonly ignored: true }
    };
  }

  return {
    ok: true,
    content: reader(path)
  };
}
