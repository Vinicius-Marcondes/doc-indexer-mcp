import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createStructuredError, type StructuredError } from "../shared/errors";

const capturedScriptNames = ["test", "typecheck", "lint", "dev", "build", "start"] as const;
const bunRelatedPackageNames = new Set(["@types/bun", "bun-types", "bun"]);
const mcpPackageNames = new Set(["@modelcontextprotocol/server", "@modelcontextprotocol/client", "@modelcontextprotocol/sdk"]);

export type CapturedScriptName = (typeof capturedScriptNames)[number];

export interface PackageJsonDetection {
  readonly hasTypesBun: boolean;
  readonly hasTypeScript: boolean;
  readonly hasMcpPackage: boolean;
  readonly bunRelatedPackages: string[];
}

export interface PackageJsonAnalysis {
  readonly exists: boolean;
  readonly path: string;
  readonly name?: string;
  readonly type?: string;
  readonly scripts: Partial<Record<CapturedScriptName, string>>;
  readonly dependencies: Record<string, string>;
  readonly devDependencies: Record<string, string>;
  readonly optionalDependencies: Record<string, string>;
  readonly workspaces: string[];
  readonly trustedDependencies: string[];
  readonly detected: PackageJsonDetection;
}

export interface PackageJsonSuccess {
  readonly ok: true;
  readonly packageJson: PackageJsonAnalysis;
}

export interface PackageJsonFailure {
  readonly ok: false;
  readonly error: StructuredError;
}

export type PackageJsonResult = PackageJsonSuccess | PackageJsonFailure;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string");
}

function workspaces(value: unknown): string[] {
  if (Array.isArray(value)) {
    return stringArray(value);
  }

  if (isRecord(value)) {
    return stringArray(value.packages);
  }

  return [];
}

function capturedScripts(value: unknown): Partial<Record<CapturedScriptName, string>> {
  const rawScripts = stringRecord(value);
  const scripts: Partial<Record<CapturedScriptName, string>> = {};

  for (const scriptName of capturedScriptNames) {
    if (rawScripts[scriptName] !== undefined) {
      scripts[scriptName] = rawScripts[scriptName];
    }
  }

  return scripts;
}

function detection(...dependencyMaps: Record<string, string>[]): PackageJsonDetection {
  const packageNames = new Set(dependencyMaps.flatMap((dependencyMap) => Object.keys(dependencyMap)));
  const bunRelatedPackages = [...packageNames].filter((packageName) => bunRelatedPackageNames.has(packageName)).sort();

  return {
    hasTypesBun: packageNames.has("@types/bun"),
    hasTypeScript: packageNames.has("typescript"),
    hasMcpPackage: [...packageNames].some((packageName) => mcpPackageNames.has(packageName)),
    bunRelatedPackages
  };
}

function emptyAnalysis(path: string): PackageJsonAnalysis {
  return {
    exists: false,
    path,
    scripts: {},
    dependencies: {},
    devDependencies: {},
    optionalDependencies: {},
    workspaces: [],
    trustedDependencies: [],
    detected: detection({}, {}, {})
  };
}

export function parsePackageJson(projectRoot: string): PackageJsonResult {
  const packagePath = resolve(projectRoot, "package.json");

  if (!existsSync(packagePath)) {
    return {
      ok: true,
      packageJson: emptyAnalysis(packagePath)
    };
  }

  let raw: unknown;

  try {
    raw = JSON.parse(readFileSync(packagePath, "utf8"));
  } catch (error) {
    return {
      ok: false,
      error: createStructuredError("parse_failed", "package.json could not be parsed.", {
        reason: error instanceof Error ? error.message : "invalid JSON"
      })
    };
  }

  if (!isRecord(raw)) {
    return {
      ok: false,
      error: createStructuredError("parse_failed", "package.json must contain a JSON object.", {
        reason: "manifest_not_object"
      })
    };
  }

  const dependencies = stringRecord(raw.dependencies);
  const devDependencies = stringRecord(raw.devDependencies);
  const optionalDependencies = stringRecord(raw.optionalDependencies);

  return {
    ok: true,
    packageJson: {
      exists: true,
      path: packagePath,
      ...(typeof raw.name === "string" ? { name: raw.name } : {}),
      ...(typeof raw.type === "string" ? { type: raw.type } : {}),
      scripts: capturedScripts(raw.scripts),
      dependencies,
      devDependencies,
      optionalDependencies,
      workspaces: workspaces(raw.workspaces),
      trustedDependencies: stringArray(raw.trustedDependencies),
      detected: detection(dependencies, devDependencies, optionalDependencies)
    }
  };
}
