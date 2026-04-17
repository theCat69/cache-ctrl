import { findRepoRoot, loadExternalCacheEntries, readCache } from "../cache/cacheManager.js";
import { selectTopExternalEntry } from "../cache/externalCache.js";
import type { InspectExternalArgs, InspectExternalResult } from "../types/commands.js";
import { ExternalCacheFileSchema } from "../types/cache.js";
import { ErrorCode, type Result } from "../types/result.js";
import { toUnknownResult } from "../errors.js";
import { validateSubject } from "../validation.js";

/**
 * Inspects the best-matching external cache entry by subject keyword.
 *
 * @param args - {@link InspectExternalArgs}.
 * @returns Promise<Result<InspectExternalResult["value"]>>; common failures include
 * NO_MATCH, AMBIGUOUS_MATCH, PARSE_ERROR, and UNKNOWN.
 */
export async function inspectExternalCommand(
  args: InspectExternalArgs,
): Promise<Result<InspectExternalResult["value"]>> {
  try {
    const subjectValidation = validateSubject(args.subject);
    if (!subjectValidation.ok) return subjectValidation;
    const repoRoot = await findRepoRoot(process.cwd());

    const entriesResult = await loadExternalCacheEntries(repoRoot);
    if (!entriesResult.ok) return entriesResult;

    const candidates = entriesResult.value;

    if (candidates.length === 0) {
      return { ok: false, error: "No cache entries found for agent \"external\"", code: ErrorCode.NO_MATCH };
    }

    const topEntryResult = selectTopExternalEntry(candidates, args.subject);
    if (!topEntryResult.ok) return topEntryResult;

    const topReadResult = await readCache(topEntryResult.value.file);
    if (!topReadResult.ok) return topReadResult;

    const topParseResult = ExternalCacheFileSchema.safeParse(topReadResult.value);
    if (!topParseResult.success) {
      return {
        ok: false,
        error: `Malformed external cache file: ${topEntryResult.value.file}`,
        code: ErrorCode.PARSE_ERROR,
      };
    }

    return {
      ok: true,
      value: {
        ...topParseResult.data,
        file: topEntryResult.value.file,
        agent: "external",
      },
    };
  } catch (err) {
    return toUnknownResult(err);
  }
}
