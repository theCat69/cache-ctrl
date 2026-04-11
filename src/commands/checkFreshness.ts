import { findRepoRoot, readCache, writeCache } from "../cache/cacheManager.js";
import { isExternalStale, mergeHeaderMetadata, resolveTopExternalMatch } from "../cache/externalCache.js";
import { checkFreshness } from "../http/freshnessChecker.js";
import type { ExternalCacheFile, HeaderMeta } from "../types/cache.js";
import { ExternalCacheFileSchema } from "../types/cache.js";
import { ErrorCode, type Result } from "../types/result.js";
import type { CheckFreshnessArgs, CheckFreshnessResult } from "../types/commands.js";
import { getFileStem } from "../utils/fileStem.js";
import { toUnknownResult } from "../utils/errors.js";

export async function checkFreshnessCommand(args: CheckFreshnessArgs): Promise<Result<CheckFreshnessResult["value"]>> {
  try {
    const repoRoot = await findRepoRoot(process.cwd());

    // Find the best-matching external cache entry file path
    const matchResult = await resolveTopExternalMatch(repoRoot, args.subject);
    if (!matchResult.ok) return matchResult;

    const filePath = matchResult.value;

    // Load the matched entry's data
    const readResult = await readCache(filePath);
    if (!readResult.ok) return readResult;

    const parseResult = ExternalCacheFileSchema.safeParse(readResult.value);
    if (!parseResult.success) {
      return { ok: false, error: `Malformed external cache file: ${filePath}`, code: ErrorCode.PARSE_ERROR };
    }

    const cacheEntry = parseResult.data;
    const stem = getFileStem(filePath);
    const subject = cacheEntry.subject ?? stem;

    // Determine which URLs to check
    const sources = cacheEntry.sources ?? [];
    const specificSource = args.url ? sources.find((source) => source.url === args.url) : undefined;
    if (args.url && !specificSource) {
      return {
        ok: false,
        error: `URL not found in sources for subject '${subject}'`,
        code: ErrorCode.URL_NOT_FOUND,
      };
    }
    const urlsToCheck = specificSource ? [specificSource] : sources;

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
        ...(stored?.etag !== undefined ? { etag: stored.etag } : {}),
        ...(stored?.last_modified !== undefined ? { last_modified: stored.last_modified } : {}),
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
      const writeResult = await writeCache(filePath, { header_metadata: updated.header_metadata });
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
    return toUnknownResult(err);
  }
}
