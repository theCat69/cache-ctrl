import { join } from "node:path";

import { resolveLocalCacheDir } from "./localCache.js";

export type { GraphCacheFile } from "../types/cache.js";

/**
 * Resolves the absolute path to graph.json.
 */
export function resolveGraphCachePath(repoRoot: string): string {
  return join(resolveLocalCacheDir(repoRoot), "graph.json");
}
