import { join } from "node:path";

export function resolveLocalCacheDir(repoRoot: string): string {
  return join(repoRoot, ".ai", "local-context-gatherer_cache");
}

export function resolveLocalCachePath(repoRoot: string): string {
  return join(resolveLocalCacheDir(repoRoot), "context.json");
}
