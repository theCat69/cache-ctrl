import { join } from "node:path";
import { resolveCacheDir } from "./cacheManager.js";

/** Resolves the local context cache file path (`context.json`). */
export function resolveLocalCachePath(repoRoot: string): string {
  return join(resolveCacheDir("local", repoRoot), "context.json");
}

/** Resolves the local dependency graph cache file path (`graph.json`). */
export function resolveGraphCachePath(repoRoot: string): string {
  return join(resolveCacheDir("local", repoRoot), "graph.json");
}
