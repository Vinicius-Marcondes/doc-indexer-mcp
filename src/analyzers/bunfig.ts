import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ResponseWarning } from "../shared/contracts";

export type BunfigValue = string | boolean | number | string[];
export type BunfigSettings = Record<string, Record<string, BunfigValue>>;

export interface BunfigAnalysis {
  readonly exists: boolean;
  readonly path: string;
  readonly settings: BunfigSettings;
  readonly warnings: ResponseWarning[];
}

export interface BunfigSuccess {
  readonly ok: true;
  readonly bunfig: BunfigAnalysis;
}

export type BunfigResult = BunfigSuccess;

function warning(id: string, title: string, detail: string, lineNumber: number): ResponseWarning {
  return {
    id,
    title,
    detail,
    evidence: [`bunfig.toml line ${lineNumber} is malformed`],
    sources: ["local-project:bunfig.toml"]
  };
}

function sensitiveWarning(lineNumber: number): ResponseWarning {
  return {
    id: "bunfig-sensitive-key-skipped",
    title: "Sensitive-looking bunfig key skipped",
    detail: "A bunfig key looked secret-like and was not included in analysis output.",
    evidence: [`bunfig.toml line ${lineNumber} contains a sensitive-looking key`],
    sources: ["local-project:bunfig.toml"]
  };
}

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return lower.includes("token") || lower.includes("secret") || lower.includes("password") || lower.includes("key");
}

function parseValue(rawValue: string): BunfigValue | null {
  const value = rawValue.trim();

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  if (/^-?\d+(?:\.\d+)?$/u.test(value)) {
    return Number(value);
  }

  const stringMatch = /^"([^"]*)"$/u.exec(value);

  if (stringMatch?.[1] !== undefined) {
    return stringMatch[1];
  }

  if (value.startsWith("[") && value.endsWith("]")) {
    const body = value.slice(1, -1).trim();

    if (body.length === 0) {
      return [];
    }

    const items = body.split(",").map((item) => item.trim());

    if (items.every((item) => /^"[^"]*"$/u.test(item))) {
      return items.map((item) => item.slice(1, -1));
    }
  }

  return null;
}

function emptyAnalysis(path: string): BunfigAnalysis {
  return {
    exists: false,
    path,
    settings: {},
    warnings: []
  };
}

export function parseBunfig(projectRoot: string): BunfigResult {
  const bunfigPath = resolve(projectRoot, "bunfig.toml");

  if (!existsSync(bunfigPath)) {
    return {
      ok: true,
      bunfig: emptyAnalysis(bunfigPath)
    };
  }

  const settings: BunfigSettings = {};
  const warnings: ResponseWarning[] = [];
  let currentSection = "root";

  for (const [index, line] of readFileSync(bunfigPath, "utf8").split(/\r?\n/u).entries()) {
    const lineNumber = index + 1;
    const trimmed = line.trim();

    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }

    const sectionMatch = /^\[([A-Za-z0-9_.-]+)\]$/u.exec(trimmed);

    if (sectionMatch?.[1] !== undefined) {
      currentSection = sectionMatch[1];
      settings[currentSection] ??= {};
      continue;
    }

    const keyValueMatch = /^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/u.exec(trimmed);

    if (keyValueMatch?.[1] === undefined || keyValueMatch[2] === undefined) {
      warnings.push(
        warning("bunfig-malformed-line", "Malformed bunfig line", "A bunfig line could not be parsed.", lineNumber)
      );
      continue;
    }

    const key = keyValueMatch[1];

    if (isSensitiveKey(key)) {
      warnings.push(sensitiveWarning(lineNumber));
      continue;
    }

    const value = parseValue(keyValueMatch[2]);

    if (value === null) {
      warnings.push(
        warning("bunfig-malformed-line", "Malformed bunfig line", "A bunfig value could not be parsed.", lineNumber)
      );
      continue;
    }

    const section = (settings[currentSection] ??= {});
    section[key] = value;
  }

  if (Object.keys(settings.root ?? {}).length === 0) {
    delete settings.root;
  }

  return {
    ok: true,
    bunfig: {
      exists: true,
      path: bunfigPath,
      settings,
      warnings
    }
  };
}
