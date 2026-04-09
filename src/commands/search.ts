import { findRepoRoot, listCacheFiles, readCache } from "../cache/cacheManager.js";
import { getFileStem } from "../cache/externalCache.js";
import { resolveLocalCachePath } from "../cache/localCache.js";
import { rankResults } from "../search/keywordSearch.js";
import type { CacheEntry } from "../types/cache.js";
import { ExternalCacheFileSchema, LocalCacheFileSchema } from "../types/cache.js";
import { ErrorCode, type Result } from "../types/result.js";
import type { SearchArgs, SearchResult } from "../types/commands.js";

export async function searchCommand(args: SearchArgs): Promise<Result<SearchResult["value"]>> {
  try {
    const repoRoot = await findRepoRoot(process.cwd());
    const entries: CacheEntry[] = [];

    // Collect external entries
    const externalFilesResult = await listCacheFiles("external", repoRoot);
    if (!externalFilesResult.ok) return externalFilesResult;

    for (const filePath of externalFilesResult.value) {
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
      const data = parseResult.data;
      const stem = getFileStem(filePath);
      const subject = data.subject ?? stem;

      entries.push({
        file: filePath,
        agent: "external",
        subject,
        description: data.description,
        fetched_at: data.fetched_at ?? "",
      });
    }

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
    const error = err as Error;
    return { ok: false, error: error.message, code: ErrorCode.UNKNOWN };
  }
}
