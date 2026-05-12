import { extname } from "node:path";
import * as ts from "typescript";
import type { ResponseWarning } from "../shared/contracts";
import { readTextFileIfAllowed } from "../security/ignore-policy";
import { discoverSourceFiles, type DiscoveredSourceFile } from "./source-discovery";
import { parsePackageJson } from "./package-json";

export interface TestAnalysis {
  readonly testFiles: string[];
  readonly hasBunTestImport: boolean;
  readonly bunTestImports: string[];
  readonly bunTestFunctions: string[];
  readonly testScript?: string;
  readonly usesBunTestScript: boolean;
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

function isTestFile(relativePath: string): boolean {
  return /\.(test|spec)\.[cm]?[jt]sx?$/u.test(relativePath);
}

function warning(id: string, title: string, detail: string, evidence: string[]): ResponseWarning {
  return {
    id,
    title,
    detail,
    evidence,
    sources: ["local-project:test-analysis"]
  };
}

function importedBunTestFunctions(file: DiscoveredSourceFile): string[] {
  const readResult = readTextFileIfAllowed(file.path);

  if (!readResult.ok) {
    return [];
  }

  const sourceFile = ts.createSourceFile(
    file.path,
    readResult.content,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(file.path)
  );
  const functions = new Set<string>();

  function visit(node: ts.Node): void {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteralLike(node.moduleSpecifier) &&
      node.moduleSpecifier.text === "bun:test"
    ) {
      const namedBindings = node.importClause?.namedBindings;

      if (namedBindings !== undefined && ts.isNamedImports(namedBindings)) {
        for (const element of namedBindings.elements) {
          functions.add(element.name.text);
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return [...functions].sort();
}

export function analyzeTests(projectRoot: string): TestAnalysis {
  const files = discoverSourceFiles(projectRoot).files;
  const testFiles = files.filter((file) => isTestFile(file.relativePath)).map((file) => file.relativePath).sort();
  const bunTestImportFiles = new Set<string>();
  const bunTestFunctions = new Set<string>();

  for (const file of files) {
    const functions = importedBunTestFunctions(file);

    if (functions.length > 0) {
      bunTestImportFiles.add(file.relativePath);
      for (const fn of functions) {
        bunTestFunctions.add(fn);
      }
    }
  }

  const packageResult = parsePackageJson(projectRoot);
  const testScript = packageResult.ok ? packageResult.packageJson.scripts.test : undefined;
  const usesBunTestScript = typeof testScript === "string" && /\bbun\s+test\b/u.test(testScript);
  const hasBunTestImport = bunTestImportFiles.size > 0;
  const warnings: ResponseWarning[] = [];

  if (hasBunTestImport && !usesBunTestScript) {
    warnings.push(
      warning(
        "bun-test-missing-script",
        "Bun tests exist without a bun test script",
        "Test files import bun:test, but package.json does not define a test script using bun test.",
        [...bunTestImportFiles].sort().map((file) => `${file} imports bun:test`)
      )
    );
  }

  return {
    testFiles,
    hasBunTestImport,
    bunTestImports: [...bunTestImportFiles].sort(),
    bunTestFunctions: [...bunTestFunctions].sort(),
    ...(testScript === undefined ? {} : { testScript }),
    usesBunTestScript,
    warnings
  };
}
