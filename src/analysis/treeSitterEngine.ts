import { readFile } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";

import { Language, Parser, Query } from "web-tree-sitter";
import type { FileSymbols } from "./fileSymbols.js";

type LoadedLanguage = Language;

let initPromise: Promise<void> | null = null;
const languageCache = new Map<string, LoadedLanguage>();
const languageLoadPromises = new Map<string, Promise<LoadedLanguage>>();

interface SyntaxNodeLike {
  type: string;
  startIndex: number;
  endIndex: number;
  childCount: number;
  child(index: number): SyntaxNodeLike | null;
}

function stripStringQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 2) {
    return trimmed;
  }

  const firstChar = trimmed[0];
  const lastChar = trimmed[trimmed.length - 1];
  if ((firstChar === '"' && lastChar === '"') || (firstChar === "'" && lastChar === "'")) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function getNodeText(node: SyntaxNodeLike, sourceCode: string): string {
  return sourceCode.slice(node.startIndex, node.endIndex);
}

function collectNodes(rootNode: SyntaxNodeLike, onVisit: (node: SyntaxNodeLike) => void): void {
  const stack: SyntaxNodeLike[] = [rootNode];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined) {
      continue;
    }

    onVisit(node);

    for (let childIndex = node.childCount - 1; childIndex >= 0; childIndex -= 1) {
      const childNode = node.child(childIndex);
      if (childNode !== null) {
        stack.push(childNode);
      }
    }
  }
}

function queryCapturedNodes(language: LoadedLanguage, rootNode: SyntaxNodeLike, queryText: string): SyntaxNodeLike[] {
  try {
    const query = new Query(language, queryText);
    // rootNode originates from web-tree-sitter Parser.parse(), so this bridge keeps
    // local lightweight node typing while satisfying Query's stricter declaration.
    const queryRootNode = rootNode as unknown as Parameters<Query["captures"]>[0];
    const captures = query.captures(queryRootNode);
    const nodes: SyntaxNodeLike[] = [];
    for (const capture of captures) {
      if (isCaptureWithNode(capture)) {
        nodes.push(capture.node);
      }
    }
    return nodes;
  } catch {
    return [];
  }
}

function isCaptureWithNode(value: unknown): value is { node: SyntaxNodeLike } {
  if (typeof value !== "object" || value === null || !("node" in value)) {
    return false;
  }

  const node = value.node;
  return (
    typeof node === "object" &&
    node !== null &&
    "type" in node &&
    "startIndex" in node &&
    "endIndex" in node &&
    "childCount" in node &&
    "child" in node
  );
}

function uniqueNodes(nodes: SyntaxNodeLike[]): SyntaxNodeLike[] {
  const seen = new Set<string>();
  const unique: SyntaxNodeLike[] = [];
  for (const node of nodes) {
    const key = `${node.startIndex}:${node.endIndex}:${node.type}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(node);
  }
  return unique;
}

function findFirstStringLiteral(node: SyntaxNodeLike, sourceCode: string): string | null {
  let foundLiteral: string | null = null;

  collectNodes(node, (currentNode) => {
    if (foundLiteral !== null) {
      return;
    }

    if (
      currentNode.type === "string" ||
      currentNode.type === "string_fragment" ||
      currentNode.type === "string_literal" ||
      currentNode.type === "interpreted_string_literal"
    ) {
      const literalText = stripStringQuotes(getNodeText(currentNode, sourceCode));
      if (literalText.length > 0) {
        foundLiteral = literalText;
      }
    }
  });

  return foundLiteral;
}

function isPathInsideRepo(pathToCheck: string, repoRoot: string): boolean {
  return pathToCheck === repoRoot || pathToCheck.startsWith(`${repoRoot}${sep}`);
}

function addResolvedDependency(filePath: string, sourceText: string, repoRoot: string, dependencies: Set<string>): void {
  if (!sourceText.startsWith(".") && !sourceText.startsWith("/")) {
    return;
  }

  const resolvedPath = resolve(dirname(filePath), sourceText);
  if (!isPathInsideRepo(resolvedPath, repoRoot)) {
    return;
  }

  dependencies.add(resolvedPath);
}

function collectExportedDefinitionNames(exportText: string, definitions: Set<string>): void {
  const normalizedText = exportText.trim();
  if (normalizedText.startsWith("export default")) {
    definitions.add("default");
  }

  const declarationMatch = normalizedText.match(
    /export\s+(?:declare\s+)?(?:const|let|var|function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/,
  );
  const declarationName = declarationMatch?.[1];
  if (declarationName !== undefined) {
    definitions.add(declarationName);
  }

  const exportClauseMatch = normalizedText.match(/export\s*\{([^}]*)\}/);
  const clause = exportClauseMatch?.[1];
  if (clause === undefined) {
    return;
  }

  const specifiers = clause
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  for (const specifier of specifiers) {
    const aliasMatch = specifier.match(/\sas\s+([A-Za-z_$][\w$]*)$/);
    if (aliasMatch?.[1] !== undefined) {
      definitions.add(aliasMatch[1]);
      continue;
    }

    const directNameMatch = specifier.match(/^([A-Za-z_$][\w$]*)$/);
    if (directNameMatch?.[1] !== undefined) {
      definitions.add(directNameMatch[1]);
    }
  }
}

function collectQuotedImportDependencies(
  filePath: string,
  sourceCode: string,
  repoRoot: string,
  dependencies: Set<string>,
): void {
  const quotedImportPattern = /(?:^|\s)(?:import|include|require)\s*(?:\(|)(["'])([^"'\n]+)\1/gm;
  for (const match of sourceCode.matchAll(quotedImportPattern)) {
    const importSource = match[2];
    if (importSource === undefined) {
      continue;
    }

    addResolvedDependency(filePath, importSource, repoRoot, dependencies);
  }
}

function collectPythonRelativeDependencies(
  filePath: string,
  sourceCode: string,
  repoRoot: string,
  dependencies: Set<string>,
): void {
  const relativeFromImportPattern = /^\s*from\s+(\.+[A-Za-z_][\w\.]*)\s+import\b/gm;
  const relativePackageImportPattern = /^\s*from\s+(\.+)\s+import\s+(.+)$/gm;

  for (const match of sourceCode.matchAll(relativeFromImportPattern)) {
    const dottedModulePath = match[1];
    if (dottedModulePath === undefined) {
      continue;
    }

    const parentTraversalPrefix = dottedModulePath.match(/^\.+/)?.[0] ?? "";
    const modulePathWithoutPrefix = dottedModulePath.slice(parentTraversalPrefix.length);
    const parentLevelCount = Math.max(0, parentTraversalPrefix.length - 1);
    const parentTraversal = parentLevelCount > 0 ? "../".repeat(parentLevelCount) : "./";
    const moduleRelativePath = modulePathWithoutPrefix.replaceAll(".", "/");
    const joinedPath = `${parentTraversal}${moduleRelativePath}`;

    addResolvedDependency(filePath, joinedPath, repoRoot, dependencies);
  }

  for (const match of sourceCode.matchAll(relativePackageImportPattern)) {
    const parentTraversalPrefix = match[1];
    const importClause = match[2];
    if (parentTraversalPrefix === undefined || importClause === undefined) {
      continue;
    }

    const parentLevelCount = Math.max(0, parentTraversalPrefix.length - 1);
    const parentTraversal = parentLevelCount > 0 ? "../".repeat(parentLevelCount) : "./";
    const importClauseWithoutComment = importClause.split("#", 1)[0]?.trim();

    if (importClauseWithoutComment === undefined || importClauseWithoutComment.length === 0) {
      continue;
    }

    const normalizedImportClause =
      importClauseWithoutComment.startsWith("(") && importClauseWithoutComment.endsWith(")")
        ? importClauseWithoutComment.slice(1, -1)
        : importClauseWithoutComment;

    const importedModules = normalizedImportClause
      .split(",")
      .map((entry) => entry.trim())
      .map((entry) => entry.split(/\s+as\s+/i, 1)[0]?.trim())
      .filter((entry): entry is string => entry !== undefined && entry.length > 0 && entry !== "*");

    for (const importedModule of importedModules) {
      const moduleRelativePath = importedModule.replaceAll(".", "/");
      const joinedPath = `${parentTraversal}${moduleRelativePath}`;
      addResolvedDependency(filePath, joinedPath, repoRoot, dependencies);
    }
  }
}

function collectRustModuleDependencies(
  filePath: string,
  sourceCode: string,
  repoRoot: string,
  dependencies: Set<string>,
): void {
  const modDeclarationPattern = /^\s*(?:pub\s+)?mod\s+([A-Za-z_][\w]*)\s*;/gm;
  for (const match of sourceCode.matchAll(modDeclarationPattern)) {
    const moduleName = match[1];
    if (moduleName === undefined) {
      continue;
    }

    addResolvedDependency(filePath, `./${moduleName}`, repoRoot, dependencies);
    addResolvedDependency(filePath, `./${moduleName}/mod`, repoRoot, dependencies);
  }
}

function collectGoImportDependencies(
  filePath: string,
  sourceCode: string,
  repoRoot: string,
  dependencies: Set<string>,
): void {
  const singleImportPattern = /^\s*import\s+(?:[A-Za-z_][\w]*\s+)?(?:"([^"\n]+)"|`([^`\n]+)`)/gm;
  for (const match of sourceCode.matchAll(singleImportPattern)) {
    const importPath = match[1] ?? match[2];
    if (importPath === undefined) {
      continue;
    }
    addResolvedDependency(filePath, importPath, repoRoot, dependencies);
  }

  const importBlockPattern = /\bimport\s*\(([^)]*)\)/gm;
  for (const blockMatch of sourceCode.matchAll(importBlockPattern)) {
    const importBlock = blockMatch[1];
    if (importBlock === undefined) {
      continue;
    }

    const importLinePattern = /(?:^|\n)\s*(?:[A-Za-z_][\w]*\s+)?(?:"([^"\n]+)"|`([^`\n]+)`)/g;
    for (const importMatch of importBlock.matchAll(importLinePattern)) {
      const importPath = importMatch[1] ?? importMatch[2];
      if (importPath === undefined) {
        continue;
      }
      addResolvedDependency(filePath, importPath, repoRoot, dependencies);
    }
  }
}

function resolveJavaSourceRoot(filePath: string, javaPackagePath: string): string {
  const packagePath = javaPackagePath.replaceAll(".", sep);
  const sourceDirectory = dirname(filePath);

  if (
    packagePath.length > 0 &&
    (sourceDirectory === packagePath || sourceDirectory.endsWith(`${sep}${packagePath}`))
  ) {
    const rootLength = sourceDirectory.length - packagePath.length;
    const sourceRoot = sourceDirectory.slice(0, rootLength);
    const normalizedSourceRoot = sourceRoot.endsWith(sep) ? sourceRoot.slice(0, -1) : sourceRoot;
    if (normalizedSourceRoot.length > 0) {
      return normalizedSourceRoot;
    }
  }

  return sourceDirectory;
}

function collectJavaImportDependencies(
  filePath: string,
  sourceCode: string,
  repoRoot: string,
  dependencies: Set<string>,
): void {
  const packageDeclarationPattern = /^\s*package\s+([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*)\s*;/m;
  const declaredPackage = sourceCode.match(packageDeclarationPattern)?.[1];
  const sourceRoot = declaredPackage === undefined ? dirname(filePath) : resolveJavaSourceRoot(filePath, declaredPackage);
  const declaredPackageSegments = declaredPackage?.split(".") ?? [];
  const packagePrefixSegments = declaredPackageSegments.slice(0, Math.min(2, declaredPackageSegments.length));
  const packagePrefix = packagePrefixSegments.join(".");

  const importPattern = /^\s*import\s+(static\s+)?([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)+)(?:\.\*)?\s*;/gm;
  for (const match of sourceCode.matchAll(importPattern)) {
    const staticPrefix = match[1];
    const importedSymbol = match[2];
    if (importedSymbol === undefined) {
      continue;
    }

    const importSegments = importedSymbol.split(".");
    const importPathForStatic = staticPrefix === undefined ? importSegments : importSegments.slice(0, -1);
    if (importPathForStatic.length === 0) {
      continue;
    }

    if (
      packagePrefix.length > 0 &&
      !(importedSymbol === packagePrefix || importedSymbol.startsWith(`${packagePrefix}.`))
    ) {
      continue;
    }

    const importPath = importPathForStatic.join("/");
    const resolvedPath = resolve(sourceRoot, importPath);
    if (!isPathInsideRepo(resolvedPath, repoRoot)) {
      continue;
    }

    dependencies.add(resolvedPath);
  }
}

function collectCStyleIncludeDependencies(
  filePath: string,
  sourceCode: string,
  repoRoot: string,
  dependencies: Set<string>,
): void {
  const includePattern = /^\s*#\s*include\s+"([^"]+)"/gm;
  for (const match of sourceCode.matchAll(includePattern)) {
    const includePath = match[1];
    if (includePath === undefined) {
      continue;
    }

    const includeSegments = includePath.split(/[\\/]+/);
    if (includeSegments.includes("..")) {
      continue;
    }

    addResolvedDependency(filePath, `./${includePath}`, repoRoot, dependencies);
  }
}

function collectGenericLanguageDependencies(
  filePath: string,
  extension: string,
  sourceCode: string,
  normalizedRepoRoot: string,
  dependencies: Set<string>,
): void {
  collectQuotedImportDependencies(filePath, sourceCode, normalizedRepoRoot, dependencies);

  if (extension === ".py") {
    collectPythonRelativeDependencies(filePath, sourceCode, normalizedRepoRoot, dependencies);
  }

  if (extension === ".rs") {
    collectRustModuleDependencies(filePath, sourceCode, normalizedRepoRoot, dependencies);
  }

  if (extension === ".go") {
    collectGoImportDependencies(filePath, sourceCode, normalizedRepoRoot, dependencies);
  }

  if (extension === ".java") {
    collectJavaImportDependencies(filePath, sourceCode, normalizedRepoRoot, dependencies);
  }

  if (
    extension === ".c" ||
    extension === ".h" ||
    extension === ".cpp" ||
    extension === ".cc" ||
    extension === ".cxx" ||
    extension === ".hpp" ||
    extension === ".hh" ||
    extension === ".hxx"
  ) {
    collectCStyleIncludeDependencies(filePath, sourceCode, normalizedRepoRoot, dependencies);
  }
}

async function ensureInitialized(): Promise<void> {
  if (initPromise === null) {
    initPromise = Parser.init();
  }
  await initPromise;
}

async function loadLanguage(wasmPath: string): Promise<LoadedLanguage> {
  const cachedLanguage = languageCache.get(wasmPath);
  if (cachedLanguage !== undefined) {
    return cachedLanguage;
  }

  const ongoingLoad = languageLoadPromises.get(wasmPath);
  if (ongoingLoad !== undefined) {
    return ongoingLoad;
  }

  const loadPromise = Language.load(wasmPath)
    .then((loadedLanguage: Language) => {
      languageCache.set(wasmPath, loadedLanguage);
      return loadedLanguage;
    })
    .finally(() => {
      languageLoadPromises.delete(wasmPath);
    });

  languageLoadPromises.set(wasmPath, loadPromise);
  return await loadPromise;
}

/**
 * Parse a source file using Tree-sitter and extract dependency/import and export symbols.
 * Never throws; parse failures degrade to empty symbols.
 */
export async function parseFileSymbols(filePath: string, wasmPath: string, repoRoot: string): Promise<FileSymbols> {
  try {
    await ensureInitialized();
    const language = await loadLanguage(wasmPath);
    const sourceCode = await readFile(filePath, "utf8");
    const normalizedRepoRoot = resolve(repoRoot);

    const parser = new Parser();
    parser.setLanguage(language);
    const tree = parser.parse(sourceCode);
    if (tree === null) {
      return { deps: [], defs: [] };
    }
    const extension = extname(filePath).toLowerCase();
    const isTypeScriptOrJavaScript = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(extension);
    const dependencies = new Set<string>();
    const definitions = new Set<string>();

    if (isTypeScriptOrJavaScript) {
      const importNodes = queryCapturedNodes(language, tree.rootNode, "(import_statement) @import");
      const exportNodes = queryCapturedNodes(language, tree.rootNode, "(export_statement) @export");
      const callNodes = queryCapturedNodes(language, tree.rootNode, "(call_expression) @call");
      const allQueryNodes = uniqueNodes([...importNodes, ...exportNodes, ...callNodes]);

      for (const node of allQueryNodes) {
        if (node.type === "import_statement") {
          const importSource = findFirstStringLiteral(node, sourceCode);
          if (importSource !== null) {
            addResolvedDependency(filePath, importSource, normalizedRepoRoot, dependencies);
          }
          continue;
        }

        if (node.type === "export_statement") {
          const exportSource = findFirstStringLiteral(node, sourceCode);
          if (exportSource !== null) {
            addResolvedDependency(filePath, exportSource, normalizedRepoRoot, dependencies);
          }

          collectExportedDefinitionNames(getNodeText(node, sourceCode), definitions);
          continue;
        }

        if (node.type === "call_expression") {
          const callText = getNodeText(node, sourceCode).trim();
          if (callText.startsWith("require(")) {
            const requireSource = findFirstStringLiteral(node, sourceCode);
            if (requireSource !== null) {
              addResolvedDependency(filePath, requireSource, normalizedRepoRoot, dependencies);
            }
          }
        }
      }

      if (allQueryNodes.length === 0) {
        collectNodes(tree.rootNode, (node) => {
          if (node.type === "import_statement") {
            const importSource = findFirstStringLiteral(node, sourceCode);
            if (importSource !== null) {
              addResolvedDependency(filePath, importSource, normalizedRepoRoot, dependencies);
            }
          }

          if (node.type === "export_statement") {
            const exportSource = findFirstStringLiteral(node, sourceCode);
            if (exportSource !== null) {
              addResolvedDependency(filePath, exportSource, normalizedRepoRoot, dependencies);
            }

            collectExportedDefinitionNames(getNodeText(node, sourceCode), definitions);
          }

          if (node.type === "call_expression") {
            const callText = getNodeText(node, sourceCode).trim();
            if (callText.startsWith("require(")) {
              const requireSource = findFirstStringLiteral(node, sourceCode);
              if (requireSource !== null) {
                addResolvedDependency(filePath, requireSource, normalizedRepoRoot, dependencies);
              }
            }
          }
        });
      }
    }

    if (!isTypeScriptOrJavaScript) {
      collectGenericLanguageDependencies(filePath, extension, sourceCode, normalizedRepoRoot, dependencies);
    }

    return { deps: [...dependencies], defs: [...definitions] };
  } catch {
    return { deps: [], defs: [] };
  }
}
