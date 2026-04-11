import { normalize } from "node:path";

import { findRepoRoot, readCache } from "../cache/cacheManager.js";
import { resolveLocalCachePath } from "../cache/localCache.js";
import { scoreEntry } from "../search/keywordSearch.js";
import type { CacheEntry, FileFacts } from "../types/cache.js";
import type { InspectArgs, InspectResult } from "../types/commands.js";
import { LocalCacheFileSchema } from "../types/cache.js";
import { ErrorCode, type Result } from "../types/result.js";

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

  if (normalize(normalizedFolder).split("/").includes("..")) {
    return {
      ok: false,
      error: "--folder must not contain '..' path segments",
      code: ErrorCode.INVALID_ARGS,
    };
  }

  return { ok: true, value: normalizedFolder };
}

export async function inspectLocalCommand(args: InspectArgs): Promise<Result<InspectResult["value"]>> {
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
    const entry: CacheEntry = {
      file: localPath,
      agent: "local",
      subject: data.topic ?? "local",
      description: data.description,
      fetched_at: data.timestamp ?? "",
    };

    const scored = [
      {
        entry,
        content: data,
        file: localPath,
        score: scoreEntry(entry, [args.subject]),
      },
    ];
    const matched = scored.filter((candidate) => candidate.score > 0);

    if (matched.length === 0) {
      return { ok: false, error: `No cache entry matched keyword "${args.subject}"`, code: ErrorCode.FILE_NOT_FOUND };
    }

    const top = matched[0]!;
    const { tracked_files: _dropped, facts, ...rest } = top.content;

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

    const resultValue: InspectResult["value"] = {
      ...rest,
      ...(filteredFacts !== undefined ? { facts: filteredFacts } : {}),
      file: top.file,
      agent: args.agent,
    };

    return {
      ok: true,
      value: resultValue,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message, code: ErrorCode.UNKNOWN };
  }
}
