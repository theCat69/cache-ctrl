import { readFile } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";

import { Language, Parser } from "web-tree-sitter";
import type { FileSymbols } from "./fileSymbols.js";

type LoadedLanguage = Awaited<ReturnType<typeof Language.load>>;

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
    const query = language.query(queryText);
    const captures = query.captures(rootNode);
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
    .then((loadedLanguage) => {
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

    return { deps: [...dependencies], defs: [...definitions] };
  } catch {
    return { deps: [], defs: [] };
  }
}
