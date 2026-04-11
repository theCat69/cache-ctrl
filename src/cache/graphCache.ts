import { join } from "node:path";

export type { GraphCacheFile } from "../types/cache.js";

/**
 * Resolves the directory for the graph cache file.
 * Lives alongside context.json in the local cache directory.
 */
export function resolveGraphCacheDir(repoRoot: string): string {
  return join(repoRoot, ".ai", "local-context-gatherer_cache");
}

/**
 * Resolves the absolute path to graph.json.
 */
export function resolveGraphCachePath(repoRoot: string): string {
  return join(resolveGraphCacheDir(repoRoot), "graph.json");
}
