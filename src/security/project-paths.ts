import { realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { createStructuredError, type StructuredError } from "../shared/errors";

export interface SafeProjectRoot {
  readonly ok: true;
  readonly projectRoot: string;
  readonly realProjectRoot: string;
}

export interface SafeResolvedPath {
  readonly ok: true;
  readonly path: string;
  readonly realPath: string;
}

export interface PathErrorResult {
  readonly ok: false;
  readonly error: StructuredError;
}

export type ProjectRootResult = SafeProjectRoot | PathErrorResult;
export type SafePathResult = SafeResolvedPath | PathErrorResult;

function unsafePathError(message: string, reason: string): PathErrorResult {
  return {
    ok: false,
    error: createStructuredError("unsafe_path", message, { reason })
  };
}

function isWithin(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

export function resolveProjectRoot(projectPath: string): ProjectRootResult {
  const projectRoot = resolve(projectPath);

  let stats;
  try {
    stats = statSync(projectRoot);
  } catch {
    return unsafePathError("Project path does not exist.", "missing_path");
  }

  if (!stats.isDirectory()) {
    return unsafePathError("Project path must be a directory.", "not_directory");
  }

  const realProjectRoot = realpathSync(projectRoot);

  return {
    ok: true,
    projectRoot,
    realProjectRoot
  };
}

export function resolvePathWithinProject(root: SafeProjectRoot, requestedPath: string): SafePathResult {
  const path = resolve(root.projectRoot, requestedPath);

  let realPath;
  try {
    realPath = realpathSync(path);
  } catch {
    return unsafePathError("Requested path does not exist inside the project root.", "missing_path");
  }

  if (!isWithin(root.realProjectRoot, realPath)) {
    return unsafePathError("Requested path resolves outside the project root.", "outside_project_root");
  }

  return {
    ok: true,
    path,
    realPath
  };
}
