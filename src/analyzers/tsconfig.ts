import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as ts from "typescript";
import type { ResponseWarning } from "../shared/contracts";
import { createStructuredError, type StructuredError } from "../shared/errors";

export interface TsconfigCompilerOptions {
  readonly types?: string[];
  readonly moduleResolution?: string;
  readonly module?: string;
  readonly target?: string;
  readonly noEmit?: boolean;
  readonly strict?: boolean;
  readonly skipLibCheck?: boolean;
}

export interface TsconfigDetection {
  readonly hasBunTypes: boolean;
  readonly usesBundlerModuleResolution: boolean;
  readonly usesPreserveModule: boolean;
  readonly targetsESNext: boolean;
  readonly hasNoEmit: boolean;
}

export interface TsconfigAnalysis {
  readonly exists: boolean;
  readonly path: string;
  readonly compilerOptions: TsconfigCompilerOptions;
  readonly detected: TsconfigDetection;
  readonly warnings: ResponseWarning[];
}

export interface TsconfigSuccess {
  readonly ok: true;
  readonly tsconfig: TsconfigAnalysis;
}

export interface TsconfigFailure {
  readonly ok: false;
  readonly error: StructuredError;
}

export type TsconfigResult = TsconfigSuccess | TsconfigFailure;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    return undefined;
  }

  return value;
}

function stringOption(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function booleanOption(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function warning(id: string, title: string, detail: string, evidence: string[]): ResponseWarning {
  return {
    id,
    title,
    detail,
    evidence,
    sources: ["local-project:tsconfig.json"]
  };
}

function detection(options: TsconfigCompilerOptions): TsconfigDetection {
  return {
    hasBunTypes: options.types?.includes("bun") ?? false,
    usesBundlerModuleResolution: options.moduleResolution === "bundler",
    usesPreserveModule: options.module === "Preserve" || options.module === "preserve",
    targetsESNext: options.target === "ESNext" || options.target === "esnext",
    hasNoEmit: options.noEmit === true
  };
}

function warnings(options: TsconfigCompilerOptions): ResponseWarning[] {
  const detected = detection(options);
  const result: ResponseWarning[] = [];

  if (!detected.hasBunTypes) {
    result.push(
      warning("tsconfig-missing-bun-types", 'tsconfig is missing types: ["bun"]', "Bun globals may be untyped.", [
        "compilerOptions.types does not include bun"
      ])
    );
  }

  if (options.moduleResolution !== undefined && options.moduleResolution !== "bundler") {
    result.push(
      warning(
        "tsconfig-non-bundler-resolution",
        "tsconfig uses non-bundler module resolution",
        "Bun docs recommend bundler-style module resolution for Bun TypeScript projects.",
        [`compilerOptions.moduleResolution=${options.moduleResolution}`]
      )
    );
  }

  return result;
}

function emptyAnalysis(path: string): TsconfigAnalysis {
  const compilerOptions: TsconfigCompilerOptions = {};

  return {
    exists: false,
    path,
    compilerOptions,
    detected: detection(compilerOptions),
    warnings: []
  };
}

function extractCompilerOptions(rawOptions: unknown): TsconfigCompilerOptions {
  if (!isRecord(rawOptions)) {
    return {};
  }

  return {
    ...(stringArray(rawOptions.types) === undefined ? {} : { types: stringArray(rawOptions.types) }),
    ...(stringOption(rawOptions.moduleResolution) === undefined
      ? {}
      : { moduleResolution: stringOption(rawOptions.moduleResolution) }),
    ...(stringOption(rawOptions.module) === undefined ? {} : { module: stringOption(rawOptions.module) }),
    ...(stringOption(rawOptions.target) === undefined ? {} : { target: stringOption(rawOptions.target) }),
    ...(booleanOption(rawOptions.noEmit) === undefined ? {} : { noEmit: booleanOption(rawOptions.noEmit) }),
    ...(booleanOption(rawOptions.strict) === undefined ? {} : { strict: booleanOption(rawOptions.strict) }),
    ...(booleanOption(rawOptions.skipLibCheck) === undefined ? {} : { skipLibCheck: booleanOption(rawOptions.skipLibCheck) })
  };
}

export function parseTsconfig(projectRoot: string): TsconfigResult {
  const tsconfigPath = resolve(projectRoot, "tsconfig.json");

  if (!existsSync(tsconfigPath)) {
    return {
      ok: true,
      tsconfig: emptyAnalysis(tsconfigPath)
    };
  }

  const text = readFileSync(tsconfigPath, "utf8");
  const parsed = ts.parseConfigFileTextToJson(tsconfigPath, text);

  if (parsed.error !== undefined) {
    return {
      ok: false,
      error: createStructuredError("parse_failed", "tsconfig.json could not be parsed.", {
        reason: ts.flattenDiagnosticMessageText(parsed.error.messageText, "\n")
      })
    };
  }

  if (!isRecord(parsed.config)) {
    return {
      ok: false,
      error: createStructuredError("parse_failed", "tsconfig.json must contain a JSON object.", {
        reason: "tsconfig_not_object"
      })
    };
  }

  const compilerOptions = extractCompilerOptions(parsed.config.compilerOptions);

  return {
    ok: true,
    tsconfig: {
      exists: true,
      path: tsconfigPath,
      compilerOptions,
      detected: detection(compilerOptions),
      warnings: warnings(compilerOptions)
    }
  };
}
