import { join } from "node:path";

/** Resolves the local cache directory path under the repository root. */
export function resolveLocalCacheDir(repoRoot: string): string {
  return join(repoRoot, ".ai", "local-context-gatherer_cache");
}

/** Resolves the local context cache file path (`context.json`). */
export function resolveLocalCachePath(repoRoot: string): string {
  return join(resolveLocalCacheDir(repoRoot), "context.json");
}

/** Resolves the local dependency graph cache file path (`graph.json`). */
export function resolveGraphCachePath(repoRoot: string): string {
  return join(resolveLocalCacheDir(repoRoot), "graph.json");
}
