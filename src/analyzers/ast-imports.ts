import { extname } from "node:path";
import * as ts from "typescript";
import { readTextFileIfAllowed } from "../security/ignore-policy";

export type ImportSpecifierKind =
  | "bun"
  | "bun-test"
  | "bun-sqlite"
  | "node"
  | "package"
  | "relative"
  | "path-alias";

export type ImportKind = "static" | "export" | "dynamic";

export interface ImportAnalysisInputFile {
  readonly path: string;
  readonly relativePath: string;
}

export interface ImportFinding {
  readonly specifier: string;
  readonly kind: ImportSpecifierKind;
  readonly importKind: ImportKind;
  readonly filePath: string;
  readonly relativePath: string;
  readonly line: number;
}

export interface ImportAnalysis {
  readonly imports: ImportFinding[];
  readonly skippedFiles: string[];
}

function scriptKindFor(path: string): ts.ScriptKind {
  switch (extname(path)) {
    case ".tsx":
      return ts.ScriptKind.TSX;
    case ".jsx":
      return ts.ScriptKind.JSX;
    case ".js":
      return ts.ScriptKind.JS;
    case ".mts":
      return ts.ScriptKind.TS;
    case ".cts":
      return ts.ScriptKind.TS;
    default:
      return ts.ScriptKind.TS;
  }
}

function classify(specifier: string): ImportSpecifierKind {
  if (specifier === "bun:test") {
    return "bun-test";
  }

  if (specifier === "bun:sqlite") {
    return "bun-sqlite";
  }

  if (specifier === "bun" || specifier.startsWith("bun:")) {
    return "bun";
  }

  if (specifier.startsWith("node:")) {
    return "node";
  }

  if (specifier.startsWith(".")) {
    return "relative";
  }

  if (specifier.startsWith("/") || specifier.startsWith("@/")) {
    return "path-alias";
  }

  return "package";
}

function lineFor(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function stringLiteralValue(node: ts.Node | undefined): string | null {
  if (node !== undefined && ts.isStringLiteralLike(node)) {
    return node.text;
  }

  return null;
}

export function analyzeImports(files: ImportAnalysisInputFile[]): ImportAnalysis {
  const imports: ImportFinding[] = [];
  const skippedFiles: string[] = [];

  for (const file of files) {
    const readResult = readTextFileIfAllowed(file.path);

    if (!readResult.ok) {
      skippedFiles.push(file.relativePath);
      continue;
    }

    const sourceFile = ts.createSourceFile(
      file.path,
      readResult.content,
      ts.ScriptTarget.Latest,
      true,
      scriptKindFor(file.path)
    );

    function addImport(specifier: string, importKind: ImportKind, node: ts.Node): void {
      imports.push({
        specifier,
        kind: classify(specifier),
        importKind,
        filePath: file.path,
        relativePath: file.relativePath,
        line: lineFor(sourceFile, node)
      });
    }

    function visit(node: ts.Node): void {
      if (ts.isImportDeclaration(node)) {
        const specifier = stringLiteralValue(node.moduleSpecifier);

        if (specifier !== null) {
          addImport(specifier, "static", node);
        }
      }

      if (ts.isExportDeclaration(node)) {
        const specifier = stringLiteralValue(node.moduleSpecifier);

        if (specifier !== null) {
          addImport(specifier, "export", node);
        }
      }

      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const specifier = stringLiteralValue(node.arguments[0]);

        if (specifier !== null) {
          addImport(specifier, "dynamic", node);
        }
      }

      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }

  return {
    imports: imports.sort((left, right) =>
      left.relativePath === right.relativePath ? left.line - right.line : left.relativePath.localeCompare(right.relativePath)
    ),
    skippedFiles
  };
}
