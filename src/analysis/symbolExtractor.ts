import { readFile } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";

import { parse } from "@typescript-eslint/typescript-estree";

export interface FileSymbols {
  /** Resolved file paths this file imports from (relative imports only, resolved to absolute) */
  deps: string[];
  /** Exported symbol names declared in this file */
  defs: string[];
}

interface AstNode {
  type: string;
  [key: string]: unknown;
}

const SUPPORTED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);

function isAstNode(value: unknown): value is AstNode {
  return typeof value === "object" && value !== null && "type" in value;
}

function walkAst(value: unknown, visitor: (node: AstNode) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      walkAst(item, visitor);
    }
    return;
  }

  if (typeof value !== "object" || value === null) {
    return;
  }

  if (isAstNode(value)) {
    visitor(value);
  }

  for (const child of Object.values(value)) {
    walkAst(child, visitor);
  }
}

function collectPatternIdentifiers(pattern: unknown, defs: Set<string>): void {
  if (!isAstNode(pattern)) {
    return;
  }

  if (pattern.type === "Identifier") {
    const name = pattern.name;
    if (typeof name === "string") {
      defs.add(name);
    }
    return;
  }

  if (pattern.type === "RestElement") {
    collectPatternIdentifiers(pattern.argument, defs);
    return;
  }

  if (pattern.type === "AssignmentPattern") {
    collectPatternIdentifiers(pattern.left, defs);
    return;
  }

  if (pattern.type === "ArrayPattern") {
    const elements = pattern.elements;
    if (Array.isArray(elements)) {
      for (const element of elements) {
        collectPatternIdentifiers(element, defs);
      }
    }
    return;
  }

  if (pattern.type === "ObjectPattern") {
    const properties = pattern.properties;
    if (!Array.isArray(properties)) {
      return;
    }

    for (const property of properties) {
      if (!isAstNode(property)) {
        continue;
      }

      if (property.type === "Property") {
        collectPatternIdentifiers(property.value, defs);
      }

      if (property.type === "RestElement") {
        collectPatternIdentifiers(property.argument, defs);
      }
    }
  }
}

function collectNamesFromDeclaration(declaration: unknown, defs: Set<string>): void {
  if (!isAstNode(declaration)) {
    return;
  }

  if (declaration.type === "FunctionDeclaration" || declaration.type === "ClassDeclaration") {
    const id = declaration.id;
    if (isAstNode(id) && id.type === "Identifier") {
      const name = id.name;
      if (typeof name === "string") {
        defs.add(name);
      }
    }
    return;
  }

  if (declaration.type === "VariableDeclaration") {
    const declarations = declaration.declarations;
    if (!Array.isArray(declarations)) {
      return;
    }

    for (const variableDeclarator of declarations) {
      if (!isAstNode(variableDeclarator) || variableDeclarator.type !== "VariableDeclarator") {
        continue;
      }
      collectPatternIdentifiers(variableDeclarator.id, defs);
    }
    return;
  }

  const id = declaration.id;
  if (isAstNode(id) && id.type === "Identifier") {
    const name = id.name;
    if (typeof name === "string") {
      defs.add(name);
    }
  }
}

function collectExportSpecifierName(specifier: unknown): string | null {
  if (!isAstNode(specifier)) {
    return null;
  }

  const exported = specifier.exported;
  if (!isAstNode(exported)) {
    return null;
  }

  if (exported.type === "Identifier") {
    return typeof exported.name === "string" ? exported.name : null;
  }

  if (exported.type === "Literal") {
    return typeof exported.value === "string" ? exported.value : null;
  }

  return null;
}

/**
 * Extract import dependencies and export definitions from a source file.
 * Returns an empty FileSymbols if the file cannot be parsed.
 * Never throws.
 */
export async function extractSymbols(filePath: string, repoRoot: string): Promise<FileSymbols> {
  try {
    const extension = extname(filePath).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(extension)) {
      return { deps: [], defs: [] };
    }

    const sourceCode = await readFile(filePath, "utf8");
    const ast = parse(sourceCode, {
      jsx: true,
      range: false,
      loc: false,
      sourceType: "module",
      errorOnUnknownASTType: false,
    });

    const normalizedRepoRoot = resolve(repoRoot);
    const repoPrefix = `${normalizedRepoRoot}${sep}`;
    const dependencies = new Set<string>();
    const definitions = new Set<string>();

    walkAst(ast, (node) => {
      if (node.type === "ImportDeclaration") {
        const source = node.source;
        if (!isAstNode(source) || source.type !== "Literal") {
          return;
        }

        const importValue = source.value;
        if (typeof importValue !== "string") {
          return;
        }

        if (!importValue.startsWith(".") && !importValue.startsWith("/")) {
          return;
        }

        const resolvedDependency = resolve(dirname(filePath), importValue);
        if (resolvedDependency === normalizedRepoRoot || resolvedDependency.startsWith(repoPrefix)) {
          dependencies.add(resolvedDependency);
        }
        return;
      }

      if (node.type === "ExportNamedDeclaration") {
        collectNamesFromDeclaration(node.declaration, definitions);

        const specifiers = node.specifiers;
        if (!Array.isArray(specifiers)) {
          return;
        }

        for (const specifier of specifiers) {
          const name = collectExportSpecifierName(specifier);
          if (name !== null) {
            definitions.add(name);
          }
        }
        return;
      }

      if (node.type === "ExportDefaultDeclaration") {
        definitions.add("default");
        collectNamesFromDeclaration(node.declaration, definitions);
      }
    });

    return {
      deps: [...dependencies],
      defs: [...definitions],
    };
  } catch {
    return { deps: [], defs: [] };
  }
}
