import { readFile, lstat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, isAbsolute, posix, relative, sep } from "node:path";

import { getGitDeletedFiles, getGitTrackedFiles, getUntrackedNonIgnoredFiles } from "./gitFiles.js";
import type { TrackedFile } from "../types/cache.js";
import { ErrorCode, type Result } from "../types/result.js";

interface GitFileSetDelta {
  newFiles: string[];
  deletedGitFiles: string[];
}

/**
 * Comparison outcome for one tracked file baseline.
 *
 * `status` and `reason` are coupled: `changed` uses `mtime`/`hash`, `missing` uses `missing`,
 * and `unchanged` omits `reason`. `missing` covers both deleted files and traversal-rejected
 * paths blocked by path-safety guards.
 */
export interface FileComparisonResult {
  path: string;
  status: "changed" | "unchanged" | "missing";
  reason?: "mtime" | "hash" | "missing";
}

/**
 * Computes repo-level staleness status from tracked baselines and git deltas.
 */
export async function detectTrackedFilesStatus(
  trackedFiles: TrackedFile[],
  repoRoot: string,
): Promise<Result<"changed" | "unchanged">> {
  try {
    const comparisons = await Promise.all(trackedFiles.map((file) => compareTrackedFile(file, repoRoot)));
    const hasTrackedDiff = comparisons.some((comparison) => comparison.status !== "unchanged");
    const { newFiles, deletedGitFiles } = await computeGitFileSetDelta(trackedFiles, repoRoot);

    const status = hasTrackedDiff || newFiles.length > 0 || deletedGitFiles.length > 0 ? "changed" : "unchanged";
    return { ok: true, value: status };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message, code: ErrorCode.UNKNOWN };
  }
}

/**
 * Compares one tracked file against current filesystem state.
 *
 * Uses `mtime` as a fast path and falls back to SHA-256 hash comparison when stored hash is
 * available and `mtime` changed. Paths that escape `repoRoot` are rejected by traversal guard
 * and reported as `missing`. `ENOENT` is also reported as `missing`.
 */
export async function compareTrackedFile(file: TrackedFile, repoRoot: string): Promise<FileComparisonResult> {
  const absolutePath = resolveTrackedFilePath(file.path, repoRoot);

  if (absolutePath === null) {
    // Path traversal attempt — treat as missing
    return { path: file.path, status: "missing", reason: "missing" };
  }

  try {
    // lstat: mtime reflects the symlink node, not the target; hash check covers content drift when hash is stored
    const fileStat = await lstat(absolutePath);
    const currentMtime = fileStat.mtimeMs;

    if (currentMtime === file.mtime) {
      return { path: file.path, status: "unchanged" };
    }

    // mtime differs
    if (file.hash) {
      const currentHash = await computeFileHash(absolutePath);
      if (currentHash === file.hash) {
        // Hash matches despite mtime change — just a touch
        return { path: file.path, status: "unchanged" };
      }
      return { path: file.path, status: "changed", reason: "hash" };
    }

    // No hash stored — mtime change alone is sufficient
    return { path: file.path, status: "changed", reason: "mtime" };
  } catch (err) {
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      return { path: file.path, status: "missing", reason: "missing" };
    }
    // Re-throw unexpected errors
    throw err;
  }
}

/** Computes SHA-256 hex digest for a file's current bytes. */
export async function computeFileHash(filePath: string): Promise<string> {
  const content = await readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Resolves a tracked file path against the repo root.
 * Returns null if the resolved path escapes the repo root (path traversal guard).
 */
export function resolveTrackedFilePath(inputPath: string, repoRoot: string): string | null {
  const resolved = isAbsolute(inputPath) ? resolve(inputPath) : resolve(repoRoot, inputPath);
  // Normalize root to ensure trailing slash for prefix matching
  const normalizedRoot = repoRoot.endsWith("/") ? repoRoot : repoRoot + "/";
  if (!resolved.startsWith(normalizedRoot) && resolved !== repoRoot) {
    return null; // path traversal rejected
  }
  return resolved;
}

export function toRepoRelativePosixPath(filePath: string, repoRoot: string): string {
  const relPath = isAbsolute(filePath) ? relative(repoRoot, filePath) : filePath;
  return relPath.split(sep).join(posix.sep);
}

export async function computeGitFileSetDelta(trackedFiles: TrackedFile[], repoRoot: string): Promise<GitFileSetDelta> {
  const [gitTrackedFiles, deletedGitFiles, untrackedNonIgnoredFiles] = await Promise.all([
    getGitTrackedFiles(repoRoot),
    getGitDeletedFiles(repoRoot),
    getUntrackedNonIgnoredFiles(repoRoot),
  ]);

  const cachedPaths = new Set(trackedFiles.map((file) => toRepoRelativePosixPath(file.path, repoRoot)));
  const baseFiles = trackedFiles.length > 0 ? gitTrackedFiles : [];
  const newFiles = [...new Set([...baseFiles, ...untrackedNonIgnoredFiles])].filter(
    (filePath) => !cachedPaths.has(toRepoRelativePosixPath(filePath, repoRoot)),
  );

  return { newFiles, deletedGitFiles };
}

/**
 * Checks existence of already-tracked files via lstat(). Used during write to evict stale entries
 * (deleted files). Does NOT recompute mtime or hash — only confirms the file is still present on disk.
 */
export async function filterExistingFiles(files: TrackedFile[], repoRoot: string): Promise<TrackedFile[]> {
  const results = await Promise.all(
    files.map(async (file): Promise<TrackedFile | null> => {
      const absolutePath = resolveTrackedFilePath(file.path, repoRoot);
      if (absolutePath === null) {
        // Path traversal rejected — evict
        return null;
      }
      try {
        await lstat(absolutePath);
        return file;
      } catch (err) {
        if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
          return null;
        }
        throw err;
      }
    }),
  );
  return results.filter((entry): entry is TrackedFile => entry !== null);
}

/**
 * Resolves filesystem stats (mtime and hash) for a list of path-only tracked file entries.
 * For each entry: if the path is valid and the file exists, computes mtime via lstat().mtimeMs
 * and hash via SHA-256 in parallel, returning { path, mtime, hash }.
 * Falls back to { path, mtime: 0 } (no hash) on path traversal rejection or missing file.
 * Never throws — always returns gracefully.
 */
export async function resolveTrackedFileStats(
  files: Array<{ path: string }>,
  repoRoot: string,
): Promise<TrackedFile[]> {
  return Promise.all(
    files.map(async (file) => {
      const absolutePath = resolveTrackedFilePath(file.path, repoRoot);
      if (absolutePath === null) {
        return { path: file.path, mtime: 0 };
      }
      try {
        // lstat: mtime reflects the symlink node; hash is computed from the target content via readFile
        const [fileStat, hash] = await Promise.all([lstat(absolutePath), computeFileHash(absolutePath)]);
        return { path: file.path, mtime: fileStat.mtimeMs, hash };
      } catch {
        // Always return gracefully per the "never throws" contract — do not propagate filesystem errors
        return { path: file.path, mtime: 0 };
      }
    }),
  );
}
