import { findRepoRoot, readCache } from "../cache/cacheManager.js";
import { resolveLocalCachePath } from "../cache/localCache.js";
import type { FileFacts } from "../types/cache.js";
import type { InspectLocalArgs, InspectLocalResult } from "../types/commands.js";
import { LocalCacheFileSchema } from "../types/cache.js";
import { ErrorCode, type Result } from "../types/result.js";
import { toUnknownResult } from "../utils/errors.js";

function filterFacts(
  facts: Record<string, FileFacts>,
  keywords: string[],
): Record<string, FileFacts> {
  if (keywords.length === 0) return facts;
  const lowerKeywords = keywords.map((keyword) => keyword.toLowerCase());
  return Object.fromEntries(
    Object.entries(facts).filter(([path]) => lowerKeywords.some((keyword) => path.toLowerCase().includes(keyword))),
  );
}

function normalizeFolderArg(folder: string): Result<string> {
  const normalizedFolder = folder.replace(/\\/g, "/").replace(/\/+$/, "");

  if (normalizedFolder.length === 0) {
    return {
      ok: false,
      error: "--folder must not be an empty string",
      code: ErrorCode.INVALID_ARGS,
    };
  }

  if (normalizedFolder.includes("..")) {
    return {
      ok: false,
      error: "--folder must not contain '..' path segments",
      code: ErrorCode.INVALID_ARGS,
    };
  }

  return { ok: true, value: normalizedFolder };
}

/**
 * Inspects local context cache content with optional path/fact filters.
 *
 * @param args - {@link InspectLocalArgs}.
 * @returns Promise<Result<InspectLocalResult["value"]>>; common failures include INVALID_ARGS,
 * FILE_NOT_FOUND, PARSE_ERROR, and UNKNOWN.
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

    if (filteredFacts !== undefined && args.searchFacts !== undefined) {
      const loweredKeywords = args.searchFacts.map((keyword) => keyword.toLowerCase());
      filteredFacts = Object.fromEntries(
        Object.entries(filteredFacts).filter(([, factEntry]) =>
          (factEntry.facts ?? []).some((fact) => loweredKeywords.some((keyword) => fact.toLowerCase().includes(keyword))),
        ),
      );
    }

    const resultValue: InspectLocalResult["value"] = {
      ...rest,
      ...(filteredFacts !== undefined ? { facts: filteredFacts } : {}),
      file: localPath,
      agent: "local",
      ...(args.filter === undefined && args.folder === undefined && args.searchFacts === undefined
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
