import { findRepoRoot, listCacheFiles, readCache, writeCache } from "../cache/cacheManager.js";
import { getFileStem, isExternalStale, mergeHeaderMetadata } from "../cache/externalCache.js";
import { scoreEntry } from "../search/keywordSearch.js";
import { checkFreshness } from "../http/freshnessChecker.js";
import type { CacheEntry, ExternalCacheFile } from "../types/cache.js";
import { ExternalCacheFileSchema } from "../types/cache.js";
import { ErrorCode, type Result } from "../types/result.js";
import type { CheckFreshnessArgs, CheckFreshnessResult } from "../types/commands.js";
import type { HeaderMeta } from "../cache/externalCache.js";

export async function checkFreshnessCommand(args: CheckFreshnessArgs): Promise<Result<CheckFreshnessResult["value"]>> {
  try {
    const repoRoot = await findRepoRoot(process.cwd());

    // Find matching external cache entry
    const filesResult = await listCacheFiles("external", repoRoot);
    if (!filesResult.ok) return filesResult;

    const candidates: Array<{ filePath: string; entry: CacheEntry; data: ExternalCacheFile }> = [];
    for (const filePath of filesResult.value) {
      const readResult = await readCache(filePath);
      if (!readResult.ok) continue;
      const parseResult = ExternalCacheFileSchema.safeParse(readResult.value);
      if (!parseResult.success) continue;
      // Cast is safe: ExternalCacheFile and ExternalCacheFileSchema produce compatible shapes
      const data = parseResult.data as ExternalCacheFile;
      const stem = getFileStem(filePath);
      const subject = data.subject ?? stem;
      candidates.push({
        filePath,
        entry: {
          file: filePath,
          agent: "external",
          subject,
          description: data.description,
          fetched_at: data.fetched_at ?? "",
        },
        data,
      });
    }

    const keywords = [args.subject];
    const scored = candidates
      .map((c) => ({ ...c, score: scoreEntry(c.entry, keywords) }))
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score);

    if (scored.length === 0) {
      return { ok: false, error: `No cache entry matched keyword "${args.subject}"`, code: ErrorCode.NO_MATCH };
    }

    const best = scored[0]!;
    const cacheEntry = best.data;
    const subject = best.entry.subject;

    // Determine which URLs to check
    const sources = cacheEntry.sources ?? [];
    let urlsToCheck: Array<{ type: string; url: string; version?: string }>;

    if (args.url) {
      const found = sources.find((s) => s.url === args.url);
      if (!found) {
        return {
          ok: false,
          error: `URL not found in sources for subject '${subject}'`,
          code: ErrorCode.URL_NOT_FOUND,
        };
      }
      urlsToCheck = [found];
    } else {
      urlsToCheck = sources;
    }

    // Check freshness for each URL
    const sourceResults: Array<{
      url: string;
      status: "fresh" | "stale" | "error";
      http_status?: number;
      error?: string;
    }> = [];

    const headerUpdates: Record<string, HeaderMeta> = {};

    for (const source of urlsToCheck) {
      const stored = cacheEntry.header_metadata?.[source.url];
      const result = await checkFreshness({
        url: source.url,
        etag: stored?.etag,
        last_modified: stored?.last_modified,
      });

      sourceResults.push({
        url: result.url,
        status: result.status,
        ...(result.http_status !== undefined ? { http_status: result.http_status } : {}),
        ...(result.error !== undefined ? { error: result.error } : {}),
      });

      if (result.status !== "error") {
        headerUpdates[source.url] = {
          ...(result.etag !== undefined ? { etag: result.etag } : {}),
          ...(result.last_modified !== undefined ? { last_modified: result.last_modified } : {}),
          checked_at: new Date().toISOString(),
          status: result.status,
        };
      }
    }

    // Only write back if at least one URL succeeded
    const hasSuccessfulChecks = Object.keys(headerUpdates).length > 0;
    if (hasSuccessfulChecks) {
      const updated = mergeHeaderMetadata(cacheEntry, headerUpdates);
      const writeResult = await writeCache(best.filePath, { header_metadata: updated.header_metadata });
      if (!writeResult.ok) return writeResult;
    }

    // Determine overall status: entryIsOld always wins (stale by age), then anyStale, then allError
    const allError = sourceResults.every((r) => r.status === "error");
    const anyStale = sourceResults.some((r) => r.status === "stale");
    const entryIsOld = isExternalStale(cacheEntry);

    let overall: "fresh" | "stale" | "error";
    if (entryIsOld) {
      overall = "stale";
    } else if (anyStale) {
      overall = "stale";
    } else if (allError && sourceResults.length > 0) {
      overall = "error";
    } else {
      overall = "fresh";
    }

    return {
      ok: true,
      value: {
        subject,
        sources: sourceResults,
        overall,
      },
    };
  } catch (err) {
    const error = err as Error;
    return { ok: false, error: error.message, code: ErrorCode.UNKNOWN };
  }
}
