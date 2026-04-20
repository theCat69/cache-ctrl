import { findRepoRoot } from "../cache/cacheManager.js";
import { updateExternalFetchedAt } from "../cache/externalCache.js";
import { updateLocalCacheTimestamp } from "../cache/localCache.js";
import { type Result } from "../types/result.js";
import type { TouchArgs, TouchResult } from "../types/commands.js";
import { toUnknownResult } from "../errors.js";

/**
 * Marks cache entries fresh by setting timestamps to current UTC time.
 *
 * @param args - {@link TouchArgs} command arguments.
 * @returns Promise<Result<TouchResult["value"]>>; common failures include INVALID_ARGS,
 * NO_MATCH, FILE_WRITE_ERROR, and UNKNOWN.
 */
export async function touchCommand(args: TouchArgs): Promise<Result<TouchResult["value"]>> {
  try {
    const repoRoot = await findRepoRoot(process.cwd());
    const newTimestamp = new Date().toISOString();
    const touched: string[] = [];

    if (args.agent === "external") {
      const updateResult = await updateExternalFetchedAt(repoRoot, args.subject, newTimestamp);
      if (!updateResult.ok) return updateResult;
      touched.push(...updateResult.value);
    } else {
      const localUpdateResult = await updateLocalCacheTimestamp(repoRoot, newTimestamp, {
        missingBehavior: "no-match",
      });
      if (!localUpdateResult.ok) return localUpdateResult;
      touched.push(localUpdateResult.value.path);
    }

    return { ok: true, value: { touched, new_timestamp: newTimestamp } };
  } catch (err) {
    return toUnknownResult(err);
  }
}
