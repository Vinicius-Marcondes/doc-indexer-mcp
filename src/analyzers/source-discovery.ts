import { existsSync, readdirSync, statSync, type Dirent } from "node:fs";
import { extname, relative, resolve } from "node:path";
import type { ResponseWarning } from "../shared/contracts";
import { shouldIgnorePath } from "../security/ignore-policy";

const commonSourceRoots = ["src", "app", "test", "tests", "scripts", "packages"] as const;
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"]);
const defaultMaxFileSizeBytes = 512 * 1024;
const defaultMaxFiles = 1_000;

export interface DiscoveredSourceFile {
  readonly path: string;
  readonly relativePath: string;
  readonly size: number;
}

export interface SourceDiscoverySkipped {
  readonly ignoredDirectories: Record<string, number>;
  readonly ignoredFiles: string[];
  readonly oversizedFiles: string[];
  readonly binaryFiles: string[];
}

export interface SourceDiscoveryResult {
  readonly files: DiscoveredSourceFile[];
  readonly skipped: SourceDiscoverySkipped;
  readonly warnings: ResponseWarning[];
}

export interface SourceDiscoveryOptions {
  readonly maxFileSizeBytes?: number;
  readonly maxFiles?: number;
}

function increment(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

function warning(id: string, title: string, detail: string, evidence: string[]): ResponseWarning {
  return {
    id,
    title,
    detail,
    evidence,
    sources: ["local-project:source-discovery"]
  };
}

function relativePath(projectRoot: string, path: string): string {
  return relative(projectRoot, path).split(/\\/u).join("/");
}

export function discoverSourceFiles(projectRoot: string, options: SourceDiscoveryOptions = {}): SourceDiscoveryResult {
  const maxFileSizeBytes = options.maxFileSizeBytes ?? defaultMaxFileSizeBytes;
  const maxFiles = options.maxFiles ?? defaultMaxFiles;
  const files: DiscoveredSourceFile[] = [];
  const skipped: SourceDiscoverySkipped = {
    ignoredDirectories: {},
    ignoredFiles: [],
    oversizedFiles: [],
    binaryFiles: []
  };
  const warnings: ResponseWarning[] = [];

  function walk(dir: string): void {
    const directoryDecision = shouldIgnorePath(dir, "directory");

    if (directoryDecision.ignored) {
      increment(skipped.ignoredDirectories, directoryDecision.label ?? "unknown");
      return;
    }

    let entries: Dirent[];

    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (files.length >= maxFiles) {
        warnings.push(
          warning("source-discovery-file-limit", "Source file discovery limit reached", `Stopped after ${maxFiles} files.`, [
            `maxFiles=${maxFiles}`
          ])
        );
        return;
      }

      const entryPath = resolve(dir, entry.name);

      if (entry.isDirectory()) {
        walk(entryPath);
        continue;
      }

      if (!entry.isFile()) {
        skipped.ignoredFiles.push(relativePath(projectRoot, entryPath));
        continue;
      }

      const fileDecision = shouldIgnorePath(entryPath, "file");
      const entryRelativePath = relativePath(projectRoot, entryPath);

      if (fileDecision.ignored) {
        if (fileDecision.reason === "binary_file") {
          skipped.binaryFiles.push(entryRelativePath);
        } else {
          skipped.ignoredFiles.push(entryRelativePath);
        }
        continue;
      }

      if (!sourceExtensions.has(extname(entry.name))) {
        continue;
      }

      const stats = statSync(entryPath);

      if (stats.size > maxFileSizeBytes) {
        skipped.oversizedFiles.push(entryRelativePath);
        continue;
      }

      files.push({
        path: entryPath,
        relativePath: entryRelativePath,
        size: stats.size
      });
    }
  }

  for (const rootName of commonSourceRoots) {
    const rootPath = resolve(projectRoot, rootName);

    if (existsSync(rootPath) && statSync(rootPath).isDirectory()) {
      walk(rootPath);
    }
  }

  return {
    files: files.sort((left, right) => left.relativePath.localeCompare(right.relativePath)),
    skipped: {
      ignoredDirectories: skipped.ignoredDirectories,
      ignoredFiles: skipped.ignoredFiles.sort(),
      oversizedFiles: skipped.oversizedFiles.sort(),
      binaryFiles: skipped.binaryFiles.sort()
    },
    warnings
  };
}
