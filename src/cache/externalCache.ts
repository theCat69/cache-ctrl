import { join } from "node:path";
import type { ExternalCacheFile, CacheEntry } from "../types/cache.js";
import { ExternalCacheFileSchema } from "../types/cache.js";
import { ErrorCode, type Result } from "../types/result.js";
import { readCache, listCacheFiles } from "./cacheManager.js";
import { scoreEntry } from "../search/keywordSearch.js";
import { getFileStem } from "../utils/fileStem.js";

const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function resolveExternalCacheDir(repoRoot: string): string {
  return join(repoRoot, ".ai", "external-context-gatherer_cache");
}

export async function resolveExternalFiles(repoRoot: string): Promise<Result<string[]>> {
  return listCacheFiles("external", repoRoot);
}

export function isFetchedAtStale(fetchedAt: string, maxAgeMs?: number): boolean {
  if (!fetchedAt) return true;
  const threshold = maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const age = Date.now() - new Date(fetchedAt).getTime();
  return age > threshold;
}

export function isExternalStale(entry: ExternalCacheFile, maxAgeMs?: number): boolean {
  return isFetchedAtStale(entry.fetched_at ?? "", maxAgeMs);
}

export interface HeaderMeta {
  etag?: string;
  last_modified?: string;
  checked_at: string;
  status: "fresh" | "stale" | "unchecked";
}

export function mergeHeaderMetadata(
  existing: ExternalCacheFile,
  updates: Record<string, HeaderMeta>,
): ExternalCacheFile {
  return {
    ...existing,
    header_metadata: {
      ...existing.header_metadata,
      ...updates,
    },
  };
}

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
  const filesResult = await listCacheFiles("external", repoRoot);
  if (!filesResult.ok) return filesResult;

  const candidates: Array<{ filePath: string; entry: CacheEntry }> = [];
  for (const filePath of filesResult.value) {
    const readResult = await readCache(filePath);
    if (!readResult.ok) continue;
    const parseResult = ExternalCacheFileSchema.safeParse(readResult.value);
    if (!parseResult.success) continue;
    const data = parseResult.data;
    const stem = getFileStem(filePath);
    const entrySubject = data.subject ?? stem;
    candidates.push({
      filePath,
      entry: {
        file: filePath,
        agent: "external",
        subject: entrySubject,
        description: data.description,
        fetched_at: data.fetched_at ?? "",
      },
    });
  }

  const keywords = [subject];
  const scored = candidates
    .map((c) => ({ ...c, score: scoreEntry(c.entry, keywords) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return { ok: false, error: `No cache entry matched keyword "${subject}"`, code: ErrorCode.NO_MATCH };
  }

  return { ok: true, value: scored[0]!.filePath };
}
