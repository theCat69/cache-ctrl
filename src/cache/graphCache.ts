import { join } from "node:path";

import { resolveLocalCacheDir } from "./localCache.js";

export type { GraphCacheFile } from "../types/cache.js";

/**
 * Resolves the graph cache parent directory inside the local cache directory.
 */
export function resolveGraphCacheLocalDir(repoRoot: string): string {
  return resolveLocalCacheDir(repoRoot);
}

/**
 * Resolves the absolute path to graph.json.
 */
export function resolveGraphCachePath(repoRoot: string): string {
  return join(resolveGraphCacheLocalDir(repoRoot), "graph.json");
}
