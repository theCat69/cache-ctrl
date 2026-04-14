import { findRepoRoot, readCache } from "../cache/cacheManager.js";
import { resolveLocalCachePath } from "../cache/localCache.js";
import type { FileFacts } from "../types/cache.js";
import type { InspectLocalArgs, InspectLocalResult } from "../types/commands.js";
import { LocalCacheFileSchema } from "../types/cache.js";
import { ErrorCode, type Result } from "../types/result.js";
import { toUnknownResult } from "../errors.js";
import { normalizeFolderArg } from "../validation.js";

/** Maximum UTF-8 byte size of the full unfiltered facts map (~5 000 tokens at ~4 bytes/token). */
const INSPECT_LOCAL_MAX_FACTS_BYTES = 20_000;
const KEY_COUNT_LIMIT = 500;

function isEffectivelyUnfiltered(args: InspectLocalArgs): boolean {
  const hasActiveFilter = (args.filter ?? []).some((k) => k.length > 0);
  const hasActiveSearchFacts = (args.searchFacts ?? []).some((k) => k.length > 0);
  return !hasActiveFilter && args.folder === undefined && !hasActiveSearchFacts;
}

function filterFacts(
  facts: Record<string, FileFacts>,
  keywords: string[],
): Record<string, FileFacts> {
  const activeKeywords = keywords.filter((k) => k.length > 0).map((k) => k.toLowerCase());
  if (activeKeywords.length === 0) return facts;
  return Object.fromEntries(
    Object.entries(facts).filter(([path]) =>
      activeKeywords.some((keyword) => path.toLowerCase().includes(keyword)),
    ),
  );
}

/**
 * Inspects local context cache content with optional path/fact filters.
 *
 * @param args - {@link InspectLocalArgs}.
 * @returns Promise<Result<InspectLocalResult["value"]>>; common failures include INVALID_ARGS,
 * FILE_NOT_FOUND, PARSE_ERROR, PAYLOAD_TOO_LARGE, and UNKNOWN.
 */
export async function inspectLocalCommand(args: InspectLocalArgs): Promise<Result<InspectLocalResult["value"]>> {
  try {
    let normalizedFolder: string | undefined;
    if (args.folder !== undefined) {
      const folderResult = normalizeFolderArg(args.folder);
      if (!folderResult.ok) return folderResult;
      normalizedFolder = folderResult.value;
    }

    const repoRoot = await findRepoRoot(process.cwd());
    const localPath = resolveLocalCachePath(repoRoot);
    const readResult = await readCache(localPath);
    if (!readResult.ok) return readResult;

    const parseResult = LocalCacheFileSchema.safeParse(readResult.value);
    if (!parseResult.success) {
      return { ok: false, error: `Malformed local cache file: ${localPath}`, code: ErrorCode.PARSE_ERROR };
    }

    const data = parseResult.data;
    const { tracked_files: _dropped, facts, ...rest } = data;

    let filteredFacts = facts;
    if (filteredFacts !== undefined && normalizedFolder !== undefined) {
      filteredFacts = Object.fromEntries(
        Object.entries(filteredFacts).filter(([key]) => {
          const normalizedPath = key.replace(/\\/g, "/");
          return normalizedPath === normalizedFolder || normalizedPath.startsWith(normalizedFolder + "/");
        }),
      );
    }

    if (filteredFacts !== undefined) {
      filteredFacts = filterFacts(filteredFacts, args.filter ?? []);
    }

    const searchFacts = (args.searchFacts ?? []).filter((k) => k.length > 0);
    if (filteredFacts !== undefined && searchFacts.length > 0) {
      const loweredKeywords = searchFacts.map((keyword) => keyword.toLowerCase());
      filteredFacts = Object.fromEntries(
        Object.entries(filteredFacts).filter(([, factEntry]) =>
          (factEntry.facts ?? []).some((fact) => loweredKeywords.some((keyword) => fact.toLowerCase().includes(keyword))),
        ),
      );
    }

    // Only enforce the size limit for fully unfiltered requests; filtered results may legitimately be large.
    if (filteredFacts !== undefined && isEffectivelyUnfiltered(args)) {
      // Fast structural pre-check: avoid serializing obviously oversized payloads.
      if (Object.keys(filteredFacts).length > KEY_COUNT_LIMIT) {
        return {
          ok: false,
          error:
            `The unfiltered facts map contains more than ${KEY_COUNT_LIMIT} entries. ` +
            `Use the filter, folder, or search_facts parameter to narrow the query, ` +
            `or use the map or graph tools to navigate the codebase first.`,
          code: ErrorCode.PAYLOAD_TOO_LARGE,
        };
      }

      const json = JSON.stringify(filteredFacts);
      const serializedBytes = Buffer.byteLength(json, "utf8");
      if (serializedBytes > INSPECT_LOCAL_MAX_FACTS_BYTES) {
        return {
          ok: false,
          error:
            `The unfiltered facts map is too large (${serializedBytes} bytes, limit ${INSPECT_LOCAL_MAX_FACTS_BYTES} bytes ≈ 5 000 tokens). ` +
            `Use the filter, folder, or search_facts parameter to narrow the query, ` +
            `or use the map or graph tools to navigate the codebase first.`,
          code: ErrorCode.PAYLOAD_TOO_LARGE,
        };
      }
    }

    const resultValue: InspectLocalResult["value"] = {
      ...rest,
      ...(filteredFacts !== undefined ? { facts: filteredFacts } : {}),
      file: localPath,
      agent: "local",
      ...(isEffectivelyUnfiltered(args)
        ? {
            warning:
              "No filters provided: returning full facts map. This may exceed token limits for large codebases.",
          }
        : {}),
    };

    return {
      ok: true,
      value: resultValue,
    };
  } catch (err) {
    return toUnknownResult(err);
  }
}
