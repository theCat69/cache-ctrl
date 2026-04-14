import { unlink } from "node:fs/promises";
import { findRepoRoot, listCacheFiles } from "../cache/cacheManager.js";
import { resolveLocalCachePath } from "../cache/localCache.js";
import { ErrorCode, type Result } from "../types/result.js";
import type { FlushArgs, FlushResult } from "../types/commands.js";
import { toUnknownResult } from "../errors.js";

/**
 * Deletes cache files for one or both agent namespaces.
 *
 * @param args - {@link FlushArgs} command arguments.
 * @returns Promise<Result<FlushResult["value"]>>; common failures include
 * CONFIRMATION_REQUIRED, FILE_WRITE_ERROR, FILE_READ_ERROR, and UNKNOWN.
 */
export async function flushCommand(args: FlushArgs): Promise<Result<FlushResult["value"]>> {
  if (!args.confirm) {
    return {
      ok: false,
      error: "flush requires --confirm flag to prevent accidental data loss",
      code: ErrorCode.CONFIRMATION_REQUIRED,
    };
  }

  try {
    const repoRoot = await findRepoRoot(process.cwd());
    const deleted: string[] = [];

    if (args.agent === "external" || args.agent === "all") {
      const filesResult = await listCacheFiles("external", repoRoot);
      if (!filesResult.ok) return filesResult;

      for (const filePath of filesResult.value) {
        try {
          await unlink(filePath);
          deleted.push(filePath);
        } catch (err) {
          const error = err as NodeJS.ErrnoException;
          if (error.code !== "ENOENT") {
            return { ok: false, error: `Failed to delete ${filePath}: ${error.message}`, code: ErrorCode.FILE_WRITE_ERROR };
          }
        }
      }
    }

    if (args.agent === "local" || args.agent === "all") {
      const localPath = resolveLocalCachePath(repoRoot);
      try {
        await unlink(localPath);
        deleted.push(localPath);
      } catch (err) {
        const error = err as NodeJS.ErrnoException;
        if (error.code !== "ENOENT") {
          return { ok: false, error: `Failed to delete ${localPath}: ${error.message}`, code: ErrorCode.FILE_WRITE_ERROR };
        }
      }
    }

    return { ok: true, value: { deleted, count: deleted.length } };
  } catch (err) {
    return toUnknownResult(err);
  }
}
