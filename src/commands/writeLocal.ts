import { join } from "node:path";

import { findRepoRoot, readCache, resolveCacheDir, writeCache } from "../cache/cacheManager.js";
import { filterExistingFiles, resolveTrackedFileStats } from "../files/changeDetector.js";
import type { WriteArgs, WriteResult } from "../types/commands.js";
import { type FileFacts, LocalCacheFileSchema, type TrackedFile, TrackedFileSchema } from "../types/cache.js";
import { ErrorCode, type Result } from "../types/result.js";
import { toUnknownResult } from "../utils/errors.js";
import { formatZodError } from "../utils/validate.js";

function evictFactsForDeletedPaths(
  facts: Record<string, unknown>,
  survivingFiles: TrackedFile[],
): Record<string, unknown> {
  const survivingPaths = new Set(survivingFiles.map((file) => file.path));
  return Object.fromEntries(Object.entries(facts).filter(([path]) => survivingPaths.has(path)));
}

function hasStringPath(entry: unknown): entry is { path: string } {
  if (typeof entry !== "object" || entry === null) {
    return false;
  }
  const pathValue = (entry as Record<string, unknown>)["path"];
  return typeof pathValue === "string";
}

function getSubmittedTrackedPaths(rawTrackedFiles: unknown): string[] {
  if (!Array.isArray(rawTrackedFiles)) return [];

  return rawTrackedFiles.filter(hasStringPath).map((entry) => entry.path);
}

/**
 * Validates and writes local context cache content with per-path merge semantics.
 *
 * @param args - {@link WriteArgs} command arguments for the local agent.
 * @returns Promise<Result<WriteResult["value"]>>; common failures include VALIDATION_ERROR,
 * FILE_READ_ERROR/FILE_WRITE_ERROR, LOCK_TIMEOUT/LOCK_ERROR, and UNKNOWN.
 */
export async function writeLocalCommand(args: WriteArgs): Promise<Result<WriteResult["value"]>> {
  try {
    const repoRoot = await findRepoRoot(process.cwd());

    const contentWithTimestamp: Record<string, unknown> = {
      ...args.content,
      timestamp: new Date().toISOString(),
    };

    const submittedPaths = getSubmittedTrackedPaths(contentWithTimestamp["tracked_files"]);
    const guardedPaths = new Set(submittedPaths);
    const resolvedTrackedFiles = await resolveTrackedFileStats(submittedPaths.map((path) => ({ path })), repoRoot);
    const survivingSubmitted = resolvedTrackedFiles.filter((trackedFile) => trackedFile.mtime !== 0);

    const rawFactsValue = contentWithTimestamp["facts"];
    const submittedFactsObject =
      typeof rawFactsValue === "object" && rawFactsValue !== null && !Array.isArray(rawFactsValue)
        ? rawFactsValue
        : undefined;
    const submittedFacts = submittedFactsObject ?? {};
    if (submittedFactsObject !== undefined) {
      const violatingPaths = Object.keys(submittedFacts).filter((path) => !guardedPaths.has(path));
      if (violatingPaths.length > 0) {
        return {
          ok: false,
          error: `facts contains paths not in submitted tracked_files: ${violatingPaths.join(", ")}`,
          code: ErrorCode.VALIDATION_ERROR,
        };
      }
    }

    const localCacheDir = resolveCacheDir("local", repoRoot);
    const filePath = join(localCacheDir, "context.json");

    const readResult = await readCache(filePath);
    let existingContent: Record<string, unknown> = {};
    let existingTrackedFiles: TrackedFile[] = [];
    let existingFacts: Record<string, FileFacts> = {};

    if (readResult.ok) {
      existingContent = readResult.value;
      const localParseResult = LocalCacheFileSchema.safeParse(existingContent);
      if (localParseResult.success) {
        existingTrackedFiles = localParseResult.data.tracked_files;
        existingFacts = localParseResult.data.facts ?? {};
      } else {
        const trackedFilesResult = TrackedFileSchema.array().safeParse(existingContent["tracked_files"]);
        existingTrackedFiles = trackedFilesResult.success ? trackedFilesResult.data : [];
      }
    } else if (readResult.code !== ErrorCode.FILE_NOT_FOUND) {
      return { ok: false, error: readResult.error, code: readResult.code };
    }

    const submittedTrackedPaths = new Set(survivingSubmitted.map((trackedFile) => trackedFile.path));
    const existingNotSubmitted = existingTrackedFiles.filter((trackedFile) => !submittedTrackedPaths.has(trackedFile.path));
    const survivingExisting = await filterExistingFiles(existingNotSubmitted, repoRoot);
    const mergedTrackedFiles = [...survivingExisting, ...survivingSubmitted];

    const rawMergedFacts = { ...existingFacts, ...submittedFacts };
    const mergedFacts = evictFactsForDeletedPaths(rawMergedFacts, mergedTrackedFiles);

    const processedContent: Record<string, unknown> = {
      ...existingContent,
      ...contentWithTimestamp,
      tracked_files: mergedTrackedFiles,
      facts: mergedFacts,
    };

    const parsed = LocalCacheFileSchema.safeParse(processedContent);
    if (!parsed.success) {
      const message = formatZodError(parsed.error);
      return { ok: false, error: `Validation failed: ${message}`, code: ErrorCode.VALIDATION_ERROR };
    }

    const writeResult = await writeCache(filePath, processedContent, "replace");
    if (!writeResult.ok) return writeResult;
    return { ok: true, value: { file: filePath } };
  } catch (err) {
    return toUnknownResult(err);
  }
}
