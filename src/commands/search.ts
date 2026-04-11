import { findRepoRoot, loadExternalCacheEntries, readCache } from "../cache/cacheManager.js";
import { resolveLocalCachePath } from "../cache/localCache.js";
import { rankResults } from "../search/keywordSearch.js";
import type { CacheEntry } from "../types/cache.js";
import { LocalCacheFileSchema } from "../types/cache.js";
import { ErrorCode, type Result } from "../types/result.js";
import type { SearchArgs, SearchResult } from "../types/commands.js";
import { toUnknownResult } from "../utils/errors.js";

/**
 * Searches cache entries across namespaces using keyword-based scoring.
 *
 * @param args - {@link SearchArgs} command arguments.
 * @returns Promise<Result<SearchResult["value"]>>; common failures include FILE_READ_ERROR
 * (external directory listing), PARSE_ERROR (malformed local cache), and UNKNOWN.
 */
export async function searchCommand(args: SearchArgs): Promise<Result<SearchResult["value"]>> {
  try {
    const repoRoot = await findRepoRoot(process.cwd());
    const entries: CacheEntry[] = [];

    // Collect external entries
    const externalEntriesResult = await loadExternalCacheEntries(repoRoot);
    if (!externalEntriesResult.ok) return externalEntriesResult;
    entries.push(...externalEntriesResult.value);

    // Collect local entry
    const localPath = resolveLocalCachePath(repoRoot);
    const localReadResult = await readCache(localPath);
    if (localReadResult.ok) {
      const parseResult = LocalCacheFileSchema.safeParse(localReadResult.value);
      if (parseResult.success) {
        const data = parseResult.data;
        entries.push({
          file: localPath,
          agent: "local",
          subject: data.topic ?? "local",
          description: data.description,
          fetched_at: data.timestamp ?? "",
        });
      } else {
        process.stderr.write(`[cache-ctrl] Warning: malformed local cache file: ${localPath}\n`);
      }
    } else if (localReadResult.code !== ErrorCode.FILE_NOT_FOUND) {
      process.stderr.write(`[cache-ctrl] Warning: could not read local cache: ${localReadResult.error}\n`);
    }

    const ranked = rankResults(entries, args.keywords);

    return {
      ok: true,
      value: ranked.map((entry) => ({
        file: entry.file,
        subject: entry.subject,
        ...(entry.description !== undefined ? { description: entry.description } : {}),
        agent: entry.agent,
        fetched_at: entry.fetched_at,
        score: entry.score ?? 0,
      })),
    };
  } catch (err) {
    return toUnknownResult(err);
  }
}
