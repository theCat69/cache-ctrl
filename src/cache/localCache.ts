import { join } from "node:path";
import type { TrackedFile } from "../types/cache.js";

export { TrackedFile };

export function resolveLocalCacheDir(repoRoot: string): string {
  return join(repoRoot, ".ai", "local-context-gatherer_cache");
}

export function resolveLocalCachePath(repoRoot: string): string {
  return join(resolveLocalCacheDir(repoRoot), "context.json");
}
