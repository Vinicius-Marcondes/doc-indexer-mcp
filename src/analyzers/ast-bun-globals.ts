import { extname } from "node:path";
import * as ts from "typescript";
import type { ResponseWarning } from "../shared/contracts";
import { readTextFileIfAllowed } from "../security/ignore-policy";

const bunMembers = ["serve", "file", "write", "spawn", "password", "env"] as const;
const bunMemberSet = new Set<string>(bunMembers);

export type BunGlobalMember = (typeof bunMembers)[number];

export interface BunGlobalAnalysisInputFile {
  readonly path: string;
  readonly relativePath: string;
}

export interface BunGlobalFinding {
  readonly member: BunGlobalMember;
  readonly filePath: string;
  readonly relativePath: string;
  readonly line: number;
}

export interface BunGlobalUsageSummary {
  readonly count: number;
  readonly evidence: string[];
}

export interface BunGlobalAnalysis {
  readonly findings: BunGlobalFinding[];
  readonly usages: Partial<Record<BunGlobalMember, BunGlobalUsageSummary>>;
  readonly warnings: ResponseWarning[];
}

function scriptKindFor(path: string): ts.ScriptKind {
  switch (extname(path)) {
    case ".tsx":
      return ts.ScriptKind.TSX;
    case ".jsx":
      return ts.ScriptKind.JSX;
    case ".js":
      return ts.ScriptKind.JS;
    default:
      return ts.ScriptKind.TS;
  }
}

function warning(id: string, title: string, detail: string, evidence: string[]): ResponseWarning {
  return {
    id,
    title,
    detail,
    evidence,
    sources: ["local-project:source-analysis"]
  };
}

function lineFor(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function parseDiagnostics(sourceFile: ts.SourceFile): readonly ts.Diagnostic[] {
  return (sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
}

function nameIsBun(name: ts.Node | undefined): boolean {
  return name !== undefined && ts.isIdentifier(name) && name.text === "Bun";
}

function hasBunShadow(sourceFile: ts.SourceFile): boolean {
  let shadowed = false;

  function visit(node: ts.Node): void {
    if (shadowed) {
      return;
    }

    if (
      (ts.isVariableDeclaration(node) && nameIsBun(node.name)) ||
      (ts.isParameter(node) && nameIsBun(node.name)) ||
      (ts.isFunctionDeclaration(node) && nameIsBun(node.name)) ||
      (ts.isClassDeclaration(node) && nameIsBun(node.name)) ||
      (ts.isInterfaceDeclaration(node) && node.name.text === "Bun") ||
      (ts.isTypeAliasDeclaration(node) && node.name.text === "Bun")
    ) {
      shadowed = true;
      return;
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return shadowed;
}

function summarize(findings: BunGlobalFinding[]): Partial<Record<BunGlobalMember, BunGlobalUsageSummary>> {
  const usages: Partial<Record<BunGlobalMember, BunGlobalUsageSummary>> = {};

  for (const finding of findings) {
    const existing = usages[finding.member] ?? { count: 0, evidence: [] };
    usages[finding.member] = {
      count: existing.count + 1,
      evidence: [...existing.evidence, `${finding.relativePath}:${finding.line}`]
    };
  }

  return usages;
}

export function analyzeBunGlobals(files: BunGlobalAnalysisInputFile[]): BunGlobalAnalysis {
  const findings: BunGlobalFinding[] = [];
  const warnings: ResponseWarning[] = [];

  for (const file of files) {
    const readResult = readTextFileIfAllowed(file.path);

    if (!readResult.ok) {
      continue;
    }

    const sourceFile = ts.createSourceFile(
      file.path,
      readResult.content,
      ts.ScriptTarget.Latest,
      true,
      scriptKindFor(file.path)
    );

    const diagnostics = parseDiagnostics(sourceFile);

    if (diagnostics.length > 0) {
      warnings.push(
        warning(
          "bun-global-parse-diagnostic",
          "Source file has TypeScript parse diagnostics",
          "Bun global usage analysis continued with reduced confidence for this file.",
          [`${file.relativePath} has ${diagnostics.length} parse diagnostic(s)`]
        )
      );
    }

    if (hasBunShadow(sourceFile)) {
      warnings.push(
        warning(
          "bun-global-shadowed",
          "Local Bun identifier shadows the global",
          "Skipped Bun global detection for this file to avoid false positives.",
          [`${file.relativePath} declares a local Bun identifier`]
        )
      );
      continue;
    }

    function visit(node: ts.Node): void {
      if (
        ts.isPropertyAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "Bun" &&
        bunMemberSet.has(node.name.text)
      ) {
        findings.push({
          member: node.name.text as BunGlobalMember,
          filePath: file.path,
          relativePath: file.relativePath,
          line: lineFor(sourceFile, node)
        });
      }

      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }

  const sortedFindings = findings.sort((left, right) =>
    left.relativePath === right.relativePath ? left.line - right.line : left.relativePath.localeCompare(right.relativePath)
  );

  return {
    findings: sortedFindings,
    usages: summarize(sortedFindings),
    warnings
  };
}
