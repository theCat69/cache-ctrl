import { unlink } from "node:fs/promises";
import { findRepoRoot, listCacheFiles, writeCache, readCache } from "../cache/cacheManager.js";
import { isExternalStale } from "../cache/externalCache.js";
import { resolveLocalCachePath } from "../cache/localCache.js";
import { ExternalCacheFileSchema } from "../types/cache.js";
import { ErrorCode, type Result } from "../types/result.js";
import type { PruneArgs, PruneResult } from "../types/commands.js";
import { getFileStem } from "../utils/fileStem.js";

export function parseDurationMs(duration: string): number | null {
  const match = /^(\d+)(s|m|h|d)$/.exec(duration);
  if (!match) return null;
  const value = parseInt(match[1]!, 10);
  const unit = match[2]!;
  if (unit === "s") return value * 1_000;
  if (unit === "m") return value * 60_000;
  if (unit === "h") return value * 3_600_000;
  if (unit === "d") return value * 86_400_000;
  return null;
}

export async function pruneCommand(args: PruneArgs): Promise<Result<PruneResult["value"]>> {
  try {
    const repoRoot = await findRepoRoot(process.cwd());
    const agent = args.agent ?? "all";
    const doDelete = args.delete ?? false;
    const matched: Array<{ file: string; agent: "external" | "local"; subject: string }> = [];

    // Parse maxAge for external (default 24h)
    const externalMaxAgeMs = args.maxAge ? parseDurationMs(args.maxAge) : 24 * 3_600_000;
    if (args.maxAge && externalMaxAgeMs === null) {
      return { ok: false, error: `Invalid duration format: "${args.maxAge}". Use format like "24h" or "7d"`, code: ErrorCode.INVALID_ARGS };
    }

    if (agent === "external" || agent === "all") {
      const filesResult = await listCacheFiles("external", repoRoot);
      if (!filesResult.ok) return filesResult;

      for (const filePath of filesResult.value) {
        const readResult = await readCache(filePath);
        if (!readResult.ok) continue;

        const parseResult = ExternalCacheFileSchema.safeParse(readResult.value);
        if (!parseResult.success) continue;
        const data = parseResult.data;

        if (isExternalStale(data, externalMaxAgeMs ?? undefined)) {
          const stem = getFileStem(filePath);
          const subject = data.subject ?? stem;
          matched.push({ file: filePath, agent: "external", subject });
          if (doDelete) {
            try {
              await unlink(filePath);
            } catch (err) {
              const error = err as NodeJS.ErrnoException;
              if (error.code !== "ENOENT") {
                return { ok: false, error: `Failed to delete ${filePath}: ${error.message}`, code: ErrorCode.FILE_WRITE_ERROR };
              }
            }
          } else {
            const writeResult = await writeCache(filePath, { fetched_at: "" });
            if (!writeResult.ok) return writeResult;
          }
        }
      }
    }

    if (agent === "local" || agent === "all") {
      // Local always matches (age 0 rule)
      const localPath = resolveLocalCachePath(repoRoot);

      if (doDelete) {
        try {
          await unlink(localPath);
          matched.push({ file: localPath, agent: "local", subject: "local" });
        } catch (err) {
          const error = err as NodeJS.ErrnoException;
          if (error.code !== "ENOENT") {
            return { ok: false, error: `Failed to delete ${localPath}: ${error.message}`, code: ErrorCode.FILE_WRITE_ERROR };
          }
          // File didn't exist — nothing pruned, don't add to matched
        }
      } else {
        // Only invalidate if the file already exists
        const readResult = await readCache(localPath);
        if (!readResult.ok) {
          if (readResult.code === ErrorCode.FILE_NOT_FOUND) {
            // Nothing to prune — skip silently
          } else {
            return readResult;
          }
        } else {
          const writeResult = await writeCache(localPath, { timestamp: "" });
          if (!writeResult.ok) return writeResult;
          matched.push({ file: localPath, agent: "local", subject: "local" });
        }
      }
    }

    return {
      ok: true,
      value: {
        matched,
        action: doDelete ? "deleted" : "invalidated",
        count: matched.length,
      },
    };
  } catch (err) {
    const error = err as Error;
    return { ok: false, error: error.message, code: ErrorCode.UNKNOWN };
  }
}
