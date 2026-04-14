import { findRepoRoot, readCache } from "../cache/cacheManager.js";
import { resolveLocalCachePath } from "../cache/localCache.js";
import { compareTrackedFile, computeGitFileSetDelta } from "../files/changeDetector.js";
import { LocalCacheFileSchema } from "../types/cache.js";
import { ErrorCode, type Result } from "../types/result.js";
import type { CheckFilesArgs, CheckFilesResult } from "../types/commands.js";
import { toUnknownResult } from "../errors.js";

/**
 * Compares local tracked files against stored baselines and git file-set deltas.
 * @returns Promise<Result<CheckFilesResult["value"]>>; common failures include FILE_NOT_FOUND,
 * PARSE_ERROR, FILE_READ_ERROR, and UNKNOWN.
 */
export async function checkFilesCommand(args?: CheckFilesArgs): Promise<Result<CheckFilesResult["value"]>> {
  try {
    const repoRoot = await findRepoRoot(process.cwd());
    const localPath = resolveLocalCachePath(repoRoot);

    const readResult = await readCache(localPath);
    if (!readResult.ok) return readResult;

    const parseResult = LocalCacheFileSchema.safeParse(readResult.value);
    if (!parseResult.success) {
      return { ok: false, error: `Malformed local cache file: ${localPath}`, code: ErrorCode.PARSE_ERROR };
    }
    const data = parseResult.data;
    const trackedFiles = data.tracked_files;

    const changedFiles: Array<{ path: string; reason: "mtime" | "hash" | "missing" }> = [];
    const shouldIncludeUnchanged = args?.includeUnchanged === true;
    const unchangedPaths: string[] = [];

    for (const trackedFile of trackedFiles) {
      const result = await compareTrackedFile(trackedFile, repoRoot);
      if (result.status === "unchanged") {
        if (shouldIncludeUnchanged) {
          unchangedPaths.push(trackedFile.path);
        }
      } else if (result.status === "missing") {
        changedFiles.push({ path: trackedFile.path, reason: "missing" });
      } else {
        changedFiles.push({ path: trackedFile.path, reason: result.reason ?? "mtime" });
      }
    }

    const missingFiles = changedFiles.filter((file) => file.reason === "missing").map((file) => file.path);

    const { newFiles, deletedGitFiles } = await computeGitFileSetDelta(trackedFiles, repoRoot);

    return {
      ok: true,
      value: {
        status:
          changedFiles.length > 0 ||
          missingFiles.length > 0 ||
          newFiles.length > 0 ||
          deletedGitFiles.length > 0
            ? "changed"
            : "unchanged",
        changed_files: changedFiles,
        ...(shouldIncludeUnchanged ? { unchanged_files: unchangedPaths } : {}),
        missing_files: missingFiles,
        new_files: newFiles,
        deleted_git_files: deletedGitFiles,
      },
    };
  } catch (err) {
    return toUnknownResult(err);
  }
}
