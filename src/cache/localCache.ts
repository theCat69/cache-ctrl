import { join } from "node:path";

import { resolveCacheDir, writeCache, readCache } from "./cacheManager.js";
import { ErrorCode, type Result } from "../types/result.js";

/** Resolves the local context cache file path (`context.json`). */
export function resolveLocalCachePath(repoRoot: string): string {
  return join(resolveCacheDir("local", repoRoot), "context.json");
}

/** Resolves the local dependency graph cache file path (`graph.json`). */
export function resolveGraphCachePath(repoRoot: string): string {
  return join(resolveCacheDir("local", repoRoot), "graph.json");
}

type LocalCacheMissingBehavior = "ignore" | "file-not-found" | "no-match";

interface UpdateLocalTimestampOptions {
  missingBehavior: LocalCacheMissingBehavior;
}

interface UpdateLocalTimestampResult {
  updated: boolean;
  path: string;
}

/**
 * Updates local context timestamp when context.json exists.
 *
 * @param repoRoot - Repository root used to resolve local cache path.
 * @param timestamp - Timestamp value written to `context.json`.
 * @param options - Missing-file behavior policy for callers.
 */
export async function updateLocalCacheTimestamp(
  repoRoot: string,
  timestamp: string,
  options: UpdateLocalTimestampOptions,
): Promise<Result<UpdateLocalTimestampResult>> {
  const localPath = resolveLocalCachePath(repoRoot);
  const readResult = await readCache(localPath);
  if (!readResult.ok) {
    if (readResult.code !== ErrorCode.FILE_NOT_FOUND) {
      return readResult;
    }

    if (options.missingBehavior === "ignore") {
      return { ok: true, value: { updated: false, path: localPath } };
    }

    if (options.missingBehavior === "no-match") {
      return {
        ok: false,
        error: `No local cache entry matched agent "local": ${localPath}`,
        code: ErrorCode.NO_MATCH,
      };
    }

    return {
      ok: false,
      error: `Local cache file not found: ${localPath}`,
      code: ErrorCode.FILE_NOT_FOUND,
    };
  }

  const writeResult = await writeCache(localPath, { timestamp });
  if (!writeResult.ok) {
    return writeResult;
  }

  return { ok: true, value: { updated: true, path: localPath } };
}
