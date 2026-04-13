import { findRepoRoot, listCacheFiles, readCache } from "../cache/cacheManager.js";
import { scoreEntry } from "../search/keywordSearch.js";
import type { CacheEntry, ExternalCacheFile } from "../types/cache.js";
import type { InspectExternalArgs, InspectExternalResult } from "../types/commands.js";
import { ExternalCacheFileSchema } from "../types/cache.js";
import { ErrorCode, type Result } from "../types/result.js";
import { toUnknownResult } from "../utils/errors.js";
import { getFileStem } from "../utils/fileStem.js";
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

    const filesResult = await listCacheFiles("external", repoRoot);
    if (!filesResult.ok) return filesResult;

    const candidates: Array<{ entry: CacheEntry; content: ExternalCacheFile; file: string }> = [];

    for (const filePath of filesResult.value) {
      const readResult = await readCache(filePath);
      if (!readResult.ok) {
        process.stderr.write(`[cache-ctrl] Warning: skipping invalid JSON file: ${filePath}\n`);
        continue;
      }
      const parseResult = ExternalCacheFileSchema.safeParse(readResult.value);
      if (!parseResult.success) {
        process.stderr.write(`[cache-ctrl] Warning: skipping malformed external cache file: ${filePath}\n`);
        continue;
      }
      const content = parseResult.data;
      const stem = getFileStem(filePath);
      const subject = content.subject ?? stem;
      if (subject !== stem) {
        process.stderr.write(`[cache-ctrl] Warning: subject "${subject}" does not match file stem "${stem}" in ${filePath}\n`);
      }
      candidates.push({
        entry: {
          file: filePath,
          agent: "external",
          subject,
          description: content.description,
          fetched_at: content.fetched_at,
        },
        content,
        file: filePath,
      });
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
