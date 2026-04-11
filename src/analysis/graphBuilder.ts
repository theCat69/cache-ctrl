import path from "node:path";

import { extractSymbols } from "./symbolExtractor.js";

export interface GraphNode {
  deps: string[];
  defs: string[];
}

export type DependencyGraph = Map<string, GraphNode>;

const RESOLUTION_EXTENSIONS = ["", ".ts", ".tsx", ".js", ".jsx"];

function resolveDependencyToKnownFile(depPath: string, knownFiles: Set<string>): string | null {
  for (const extension of RESOLUTION_EXTENSIONS) {
    const candidatePath = `${depPath}${extension}`;
    if (knownFiles.has(candidatePath)) {
      return candidatePath;
    }
  }

  const basename = path.basename(depPath);
  if (basename.endsWith(".js")) {
    const withoutJs = depPath.slice(0, -3);
    for (const extension of [".ts", ".tsx"]) {
      const candidatePath = `${withoutJs}${extension}`;
      if (knownFiles.has(candidatePath)) {
        return candidatePath;
      }
    }
  }

  if (basename.endsWith(".jsx")) {
    const withoutJsx = depPath.slice(0, -4);
    const candidatePath = `${withoutJsx}.tsx`;
    if (knownFiles.has(candidatePath)) {
      return candidatePath;
    }
  }

  return null;
}

/**
 * Build a dependency graph for all source files under repoRoot.
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
      const resolvedDependency = resolveDependencyToKnownFile(dependency, knownFileSet);
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
