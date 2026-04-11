import { findRepoRoot, loadExternalCacheEntries, readCache } from "../cache/cacheManager.js";
import { getAgeHuman, isFetchedAtStale } from "../cache/externalCache.js";
import { resolveLocalCachePath } from "../cache/localCache.js";
import { checkFilesCommand } from "./checkFiles.js";
import { LocalCacheFileSchema } from "../types/cache.js";
import { ErrorCode, type Result } from "../types/result.js";
import type { ListArgs, ListEntry, ListResult } from "../types/commands.js";

export async function listCommand(args: ListArgs): Promise<Result<ListResult["value"]>> {
  try {
    const repoRoot = await findRepoRoot(process.cwd());
    const agent = args.agent ?? "all";
    const entries: ListEntry[] = [];

    if (agent === "external" || agent === "all") {
      const entriesResult = await loadExternalCacheEntries(repoRoot);
      if (!entriesResult.ok) return entriesResult;

      for (const entry of entriesResult.value) {
        entries.push({
          file: entry.file,
          agent: "external",
          subject: entry.subject,
          ...(entry.description !== undefined ? { description: entry.description } : {}),
          fetched_at: entry.fetched_at,
          age_human: getAgeHuman(entry.fetched_at),
          is_stale: isFetchedAtStale(entry.fetched_at),
        });
      }
    }

    if (agent === "local" || agent === "all") {
      const localPath = resolveLocalCachePath(repoRoot);
      const readResult = await readCache(localPath);

      if (readResult.ok) {
        const parseResult = LocalCacheFileSchema.safeParse(readResult.value);
        if (parseResult.success) {
          const data = parseResult.data;
          const timestamp = data.timestamp ?? "";
          const description = data.description;

          const checkResult = await checkFilesCommand();
          if (!checkResult.ok) {
            process.stderr.write(
              `[cache-ctrl] Warning: could not compute local cache staleness: ${checkResult.error}\n`,
            );
          }
          // Local entry is stale if:
          //   1. The timestamp has been zeroed (entry was invalidated), OR
          //   2. check-files reports changed files
          const isStale = !timestamp || !checkResult.ok || checkResult.value.status === "changed";

          entries.push({
            file: localPath,
            agent: "local",
            subject: data.topic ?? "local",
            ...(description !== undefined ? { description } : {}),
            fetched_at: timestamp,
            age_human: getAgeHuman(timestamp),
            is_stale: isStale,
          });
        } else {
          process.stderr.write(`[cache-ctrl] Warning: malformed local cache file: ${localPath}\n`);
        }
      } else if (readResult.code !== ErrorCode.FILE_NOT_FOUND) {
        return readResult;
      }
    }

    return { ok: true, value: entries };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg, code: ErrorCode.UNKNOWN };
  }
}
