import { ErrorCode, type Result } from "../types/result.js";
import { listCacheFiles, loadExternalCacheEntries, writeCache } from "./cacheManager.js";
import { scoreEntry } from "../search/keywordSearch.js";
import { validateSubject } from "../utils/validate.js";

const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Checks whether an external `fetched_at` timestamp exceeds staleness threshold.
 *
 * @param fetchedAt - ISO timestamp string stored in cache entry.
 * @param maxAgeMs - Optional max age override in milliseconds.
 * @returns `true` when timestamp is empty or older than the threshold.
 */
export function isFetchedAtStale(fetchedAt: string, maxAgeMs?: number): boolean {
  if (!fetchedAt) return true;
  const threshold = maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const age = Date.now() - new Date(fetchedAt).getTime();
  return age > threshold;
}

/**
 * Formats human-readable age text from an external `fetched_at` timestamp.
 *
 * @param fetchedAt - ISO timestamp string from cache entry.
 * @returns Relative age string such as `"just now"`, `"2 hours ago"`, or `"invalidated"`.
 * @remarks Returns `"invalidated"` sentinel when `fetchedAt` is empty.
 */
export function getAgeHuman(fetchedAt: string): string {
  if (!fetchedAt) return "invalidated";

  const now = Date.now();
  const fetched = new Date(fetchedAt).getTime();
  const diffMs = now - fetched;

  if (diffMs < 0) return "just now";

  const minutes = Math.floor(diffMs / 60_000);
  const hours = Math.floor(diffMs / 3_600_000);
  const days = Math.floor(diffMs / 86_400_000);

  if (days >= 1) {
    return days === 1 ? "1 day ago" : `${days} days ago`;
  }
  if (hours >= 1) {
    return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  }
  if (minutes >= 1) {
    return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
  }
  return "just now";
}

/**
 * Resolves the file path of the best-scoring external cache entry for a given subject keyword.
 * Returns NO_MATCH if no entry scores above zero.
 */
export async function resolveTopExternalMatch(repoRoot: string, subject: string): Promise<Result<string>> {
  const entriesResult = await loadExternalCacheEntries(repoRoot);
  if (!entriesResult.ok) return entriesResult;

  const keywords = [subject];
  const scored = entriesResult.value
    .map((entry) => ({ entry, score: scoreEntry(entry, keywords) }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return { ok: false, error: `No cache entry matched keyword "${subject}"`, code: ErrorCode.NO_MATCH };
  }

  return { ok: true, value: scored[0]!.entry.file };
}

/**
 * Updates `fetched_at` for one external entry (best subject match) or all entries.
 *
 * @param repoRoot - Repository root.
 * @param subject - Optional subject keyword; when provided, only top match is updated.
 * @param fetchedAt - New ISO timestamp value (or empty string to invalidate).
 * @returns Updated file paths.
 */
export async function updateExternalFetchedAt(
  repoRoot: string,
  subject: string | undefined,
  fetchedAt: string,
): Promise<Result<string[]>> {
  let filesToUpdate: string[];

  if (subject) {
    const subjectCheck = validateSubject(subject);
    if (!subjectCheck.ok) return subjectCheck;
    const matchResult = await resolveTopExternalMatch(repoRoot, subject);
    if (!matchResult.ok) return matchResult;
    filesToUpdate = [matchResult.value];
  } else {
    const filesResult = await listCacheFiles("external", repoRoot);
    if (!filesResult.ok) return filesResult;
    filesToUpdate = filesResult.value;
  }

  const updated: string[] = [];
  for (const filePath of filesToUpdate) {
    const writeResult = await writeCache(filePath, { fetched_at: fetchedAt });
    if (!writeResult.ok) return writeResult;
    updated.push(filePath);
  }

  return { ok: true, value: updated };
}
