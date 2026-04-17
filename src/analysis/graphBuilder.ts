import path from "node:path";

import { getResolutionExtensionsForFile } from "./supportedLanguages.js";
import { extractSymbols } from "./symbolExtractor.js";

/** Dependency metadata tracked for one source file node in the graph. */
export interface GraphNode {
  deps: string[];
  defs: string[];
}

/** Directed dependency graph keyed by absolute source file path. */
export type DependencyGraph = Map<string, GraphNode>;

function resolveDependencyToKnownFile(
  dependencyPath: string,
  originatingFilePath: string,
  knownFiles: Set<string>,
): string | null {
  if (knownFiles.has(dependencyPath)) {
    return dependencyPath;
  }

  const prioritizedExtensions = getResolutionExtensionsForFile(originatingFilePath);
  for (const extension of prioritizedExtensions) {
    const candidatePath = `${dependencyPath}${extension}`;
    if (knownFiles.has(candidatePath)) {
      return candidatePath;
    }
  }

  const packageInitPath = path.join(dependencyPath, "__init__.py");
  if (knownFiles.has(packageInitPath)) {
    return packageInitPath;
  }

  const basename = path.basename(dependencyPath);
  if (basename.endsWith(".js")) {
    const withoutJs = dependencyPath.slice(0, -3);
    for (const extension of [".ts", ".tsx"]) {
      const candidatePath = `${withoutJs}${extension}`;
      if (knownFiles.has(candidatePath)) {
        return candidatePath;
      }
    }
  }

  if (basename.endsWith(".jsx")) {
    const withoutJsx = dependencyPath.slice(0, -4);
    const candidatePath = `${withoutJsx}.tsx`;
    if (knownFiles.has(candidatePath)) {
      return candidatePath;
    }
  }

  return null;
}

/**
 * Build a dependency graph for all source files under repoRoot.
 *
 * @param filePaths - Source file paths to include as graph nodes.
 * @param repoRoot - Repository root for symbol extraction and import resolution.
 * @returns Dependency graph keyed by resolved absolute file paths.
 *
 * Files not in the provided list are filtered from deps.
 */
export async function buildGraph(filePaths: string[], repoRoot: string): Promise<DependencyGraph> {
  const absoluteFilePaths = filePaths.map((filePath) => path.resolve(filePath));
  const knownFileSet = new Set(absoluteFilePaths);

  const extractedSymbols = await Promise.all(
    absoluteFilePaths.map(async (filePath) => ({
      filePath,
      symbols: await extractSymbols(filePath, repoRoot),
    })),
  );

  const graph: DependencyGraph = new Map();

  for (const { filePath, symbols } of extractedSymbols) {
    const resolvedDependencies = new Set<string>();

    for (const dependency of symbols.deps) {
      const resolvedDependency = resolveDependencyToKnownFile(dependency, filePath, knownFileSet);
      if (resolvedDependency !== null) {
        resolvedDependencies.add(resolvedDependency);
      }
    }

    graph.set(filePath, {
      deps: [...resolvedDependencies],
      defs: symbols.defs,
    });
  }

  return graph;
}
