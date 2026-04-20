import { findRepoRoot, writeCache, readCache } from "../cache/cacheManager.js";
import { updateExternalFetchedAt } from "../cache/externalCache.js";
import { resolveGraphCachePath, updateLocalCacheTimestamp } from "../cache/localCache.js";
import { ErrorCode, type Result } from "../types/result.js";
import type { InvalidateArgs, InvalidateResult } from "../types/commands.js";
import { toUnknownResult } from "../errors.js";

/**
 * Marks cache entries stale by zeroing their freshness timestamps.
 *
 * @param args - {@link InvalidateArgs} command arguments.
 * @returns Promise<Result<InvalidateResult["value"]>>; common failures include INVALID_ARGS,
 * NO_MATCH, FILE_NOT_FOUND, FILE_WRITE_ERROR, and UNKNOWN.
 */
export async function invalidateCommand(args: InvalidateArgs): Promise<Result<InvalidateResult["value"]>> {
  try {
    const repoRoot = await findRepoRoot(process.cwd());
    const invalidated: string[] = [];

    if (args.agent === "external") {
      const updateResult = await updateExternalFetchedAt(repoRoot, args.subject, "");
      if (!updateResult.ok) return updateResult;
      invalidated.push(...updateResult.value);
    } else {
      const localUpdateResult = await updateLocalCacheTimestamp(repoRoot, "", {
        missingBehavior: "file-not-found",
      });
      if (!localUpdateResult.ok) return localUpdateResult;
      invalidated.push(localUpdateResult.value.path);

      const graphPath = resolveGraphCachePath(repoRoot);
      const graphReadResult = await readCache(graphPath);
      if (graphReadResult.ok) {
        const graphWriteResult = await writeCache(graphPath, { computed_at: "" });
        if (!graphWriteResult.ok) return graphWriteResult;
        invalidated.push(graphPath);
      } else if (graphReadResult.code !== ErrorCode.FILE_NOT_FOUND) {
        return graphReadResult;
      }
    }

    return { ok: true, value: { invalidated } };
  } catch (err) {
    return toUnknownResult(err);
  }
}
