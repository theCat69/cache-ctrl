import { findRepoRoot, loadExternalCacheEntries, readCache } from "../cache/cacheManager.js";
import { scoreEntry } from "../search/keywordSearch.js";
import type { CacheEntry } from "../types/cache.js";
import type { InspectExternalArgs, InspectExternalResult } from "../types/commands.js";
import { ExternalCacheFileSchema } from "../types/cache.js";
import { ErrorCode, type Result } from "../types/result.js";
import { toUnknownResult } from "../utils/errors.js";
import { validateSubject } from "../utils/validate.js";

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

    const candidates: CacheEntry[] = entriesResult.value;

    if (candidates.length === 0) {
      return { ok: false, error: "No cache entries found for agent \"external\"", code: ErrorCode.NO_MATCH };
    }

    const keywords = [args.subject];
    const scored = candidates.map((candidate) => ({
      entry: candidate,
      score: scoreEntry(candidate, keywords),
    }));
    const matched = scored.filter((candidate) => candidate.score > 0);

    if (matched.length === 0) {
      return { ok: false, error: `No cache entry matched keyword "${args.subject}"`, code: ErrorCode.NO_MATCH };
    }

    matched.sort((a, b) => b.score - a.score);

    const top = matched[0]!;
    const second = matched[1];

    if (second && top.score === second.score) {
      return {
        ok: false,
        error: `Ambiguous match: multiple entries scored equally for "${args.subject}"`,
        code: ErrorCode.AMBIGUOUS_MATCH,
      };
    }

    const topReadResult = await readCache(top.entry.file);
    if (!topReadResult.ok) return topReadResult;

    const topParseResult = ExternalCacheFileSchema.safeParse(topReadResult.value);
    if (!topParseResult.success) {
      return {
        ok: false,
        error: `Malformed external cache file: ${top.entry.file}`,
        code: ErrorCode.PARSE_ERROR,
      };
    }

    return {
      ok: true,
      value: {
        ...topParseResult.data,
        file: top.entry.file,
        agent: "external",
      },
    };
  } catch (err) {
    return toUnknownResult(err);
  }
}
