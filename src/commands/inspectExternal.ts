import { findRepoRoot, loadExternalCacheEntries, readCache } from "../cache/cacheManager.js";
import { scoreEntry } from "../search/keywordSearch.js";
import type { CacheEntry, ExternalCacheFile } from "../types/cache.js";
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
 * FILE_NOT_FOUND, AMBIGUOUS_MATCH, PARSE_ERROR, and UNKNOWN.
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

    const candidates: Array<{ entry: CacheEntry; content: ExternalCacheFile; file: string }> = [];

    for (const entry of entriesResult.value) {
      const readResult = await readCache(entry.file);
      if (!readResult.ok) continue;
      const parseResult = ExternalCacheFileSchema.safeParse(readResult.value);
      if (!parseResult.success) continue;
      candidates.push({ entry, content: parseResult.data, file: entry.file });
    }

    if (candidates.length === 0) {
      return { ok: false, error: "No cache entries found for agent \"external\"", code: ErrorCode.FILE_NOT_FOUND };
    }

    const keywords = [args.subject];
    const scored = candidates.map((candidate) => ({
      ...candidate,
      score: scoreEntry(candidate.entry, keywords),
    }));
    const matched = scored.filter((candidate) => candidate.score > 0);

    if (matched.length === 0) {
      return { ok: false, error: `No cache entry matched keyword "${args.subject}"`, code: ErrorCode.FILE_NOT_FOUND };
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

    return {
      ok: true,
      value: {
        ...top.content,
        file: top.file,
        agent: "external",
      },
    };
  } catch (err) {
    return toUnknownResult(err);
  }
}
