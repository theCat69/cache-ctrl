import { isAbsolute, posix, relative, sep } from "node:path";
import { findRepoRoot, readCache } from "../cache/cacheManager.js";
import { resolveLocalCachePath } from "../cache/localCache.js";
import { compareTrackedFile } from "../files/changeDetector.js";
import { getGitTrackedFiles, getGitDeletedFiles, getUntrackedNonIgnoredFiles } from "../files/gitFiles.js";
import { LocalCacheFileSchema } from "../types/cache.js";
import { ErrorCode, type Result } from "../types/result.js";
import type { CheckFilesResult } from "../types/commands.js";

export async function checkFilesCommand(): Promise<Result<CheckFilesResult["value"]>> {
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
    const unchangedFiles: string[] = [];
    const missingFiles: string[] = [];

    for (const trackedFile of trackedFiles) {
      const result = await compareTrackedFile(trackedFile, repoRoot);
      if (result.status === "unchanged") {
        unchangedFiles.push(trackedFile.path);
      } else if (result.status === "missing") {
        missingFiles.push(trackedFile.path);
        changedFiles.push({ path: trackedFile.path, reason: "missing" });
      } else {
        changedFiles.push({ path: trackedFile.path, reason: result.reason ?? "mtime" });
      }
    }

    const [gitTrackedFiles, deletedGitFiles, untrackedNonIgnoredFiles] = await Promise.all([
      getGitTrackedFiles(repoRoot),
      getGitDeletedFiles(repoRoot),
      getUntrackedNonIgnoredFiles(repoRoot),
    ]);
    const toRepoRelativePosix = (filePath: string): string => {
      const rel = isAbsolute(filePath) ? relative(repoRoot, filePath) : filePath;
      return rel.split(sep).join(posix.sep);
    };
    const cachedPaths = new Set(trackedFiles.map((f) => toRepoRelativePosix(f.path)));
    // When tracked_files is empty (blank-slate), skip git-tracked files from new_files
    // because those were already present before this cache was written.
    // Untracked non-ignored files are always reported as new — they represent newly
    // created files that the user added to the working tree.
    const baseFiles = trackedFiles.length > 0 ? gitTrackedFiles : [];
    const newFiles = [...new Set([...baseFiles, ...untrackedNonIgnoredFiles])].filter(
      (p) => !cachedPaths.has(toRepoRelativePosix(p)),
    );

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
        unchanged_files: unchangedFiles,
        missing_files: missingFiles,
        new_files: newFiles,
        deleted_git_files: deletedGitFiles,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg, code: ErrorCode.UNKNOWN };
  }
}
