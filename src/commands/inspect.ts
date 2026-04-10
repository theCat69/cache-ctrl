import { normalize } from "node:path";

import { findRepoRoot, loadExternalCacheEntries, readCache } from "../cache/cacheManager.js";
import { resolveLocalCachePath } from "../cache/localCache.js";
import { scoreEntry } from "../search/keywordSearch.js";
import type { CacheEntry, ExternalCacheFile, LocalCacheFile } from "../types/cache.js";
import { ExternalCacheFileSchema, LocalCacheFileSchema } from "../types/cache.js";
import { ErrorCode, type Result } from "../types/result.js";
import type { InspectArgs, InspectResult } from "../types/commands.js";

function filterFacts(
  facts: Record<string, string[]>,
  keywords: string[],
): Record<string, string[]> {
  if (keywords.length === 0) return facts;
  const lower = keywords.map((k) => k.toLowerCase());
  return Object.fromEntries(
    Object.entries(facts).filter(([path]) => lower.some((kw) => path.toLowerCase().includes(kw))),
  );
}

export async function inspectCommand(args: InspectArgs): Promise<Result<InspectResult["value"]>> {
  try {
    // Step 0 — folder guard: validate before any I/O.
    if (args.folder !== undefined) {
      if (args.agent === "external") {
        return {
          ok: false,
          error: "--folder is only supported for local cache",
          code: ErrorCode.INVALID_ARGS,
        };
      }

      const normalizedFolder = args.folder.replace(/\\/g, "/").replace(/\/+$/, "");

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
    }

    const repoRoot = await findRepoRoot(process.cwd());

    const candidates: Array<{ entry: CacheEntry; content: ExternalCacheFile | LocalCacheFile; file: string }> = [];

    if (args.agent === "external") {
      const entriesResult = await loadExternalCacheEntries(repoRoot);
      if (!entriesResult.ok) return entriesResult;

      for (const entry of entriesResult.value) {
        const readResult = await readCache(entry.file);
        if (!readResult.ok) continue;
        const parseResult = ExternalCacheFileSchema.safeParse(readResult.value);
        if (!parseResult.success) continue;
        candidates.push({ entry, content: parseResult.data, file: entry.file });
      }
    } else {
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
      candidates.push({ entry, content: data, file: localPath });
    }

    if (candidates.length === 0) {
      return { ok: false, error: `No cache entries found for agent "${args.agent}"`, code: ErrorCode.FILE_NOT_FOUND };
    }

    // Score all candidates
    const keywords = [args.subject];
    const scored = candidates.map((c) => ({
      ...c,
      score: scoreEntry(c.entry, keywords),
    }));

    // Filter out zero-score entries
    const matched = scored.filter((s) => s.score > 0);

    if (matched.length === 0) {
      return { ok: false, error: `No cache entry matched keyword "${args.subject}"`, code: ErrorCode.FILE_NOT_FOUND };
    }

    // Sort by score descending
    matched.sort((a, b) => b.score - a.score);

    const top = matched[0]!;
    const second = matched[1];

    if (second && top.score === second.score) {
      return {
        ok: false,
        error: `Ambiguous match: multiple entries scored equally for "${args.subject}"`,
        code: ErrorCode.AMBIGUOUS_MATCH,
      };
    }

    if (args.agent === "local") {
      // Destructure to strip tracked_files (internal operational metadata, never exposed
      // to callers) and to extract facts for filtering. All other fields — including
      // global_facts, topic, description, timestamp, cache_miss_reason — flow through
      // via ...rest and are always included in the response.
      const { tracked_files: _dropped, facts, ...rest } = top.content as LocalCacheFile;

      // Step 1 — folder filter: keep only entries under the specified folder prefix.
      let filteredFacts = facts;
      if (filteredFacts !== undefined && args.folder !== undefined) {
        const normalizedFolder = args.folder.replace(/\\/g, "/").replace(/\/+$/, "");
        filteredFacts = Object.fromEntries(
          Object.entries(filteredFacts).filter(([key]) => {
            const normalizedPath = key.replace(/\\/g, "/");
            return (
              normalizedPath === normalizedFolder ||
              normalizedPath.startsWith(normalizedFolder + "/")
            );
          }),
        );
      }

      // Step 2 — path keyword filter (existing --filter logic applied to already-folder-filtered set).
      if (filteredFacts !== undefined) {
        filteredFacts = filterFacts(filteredFacts, args.filter ?? []);
      }

      // Step 3 — search-facts filter: keep entries where any fact string contains any keyword.
      if (filteredFacts !== undefined && args.searchFacts !== undefined) {
        const kwsLower = args.searchFacts.map((k) => k.toLowerCase());
        filteredFacts = Object.fromEntries(
          Object.entries(filteredFacts).filter(([, factStrings]) =>
            factStrings.some((f) => kwsLower.some((kw) => f.toLowerCase().includes(kw))),
          ),
        );
      }

      return {
        ok: true,
        value: {
          ...rest,
          ...(filteredFacts !== undefined ? { facts: filteredFacts } : {}),
          file: top.file,
          agent: args.agent,
          // The cast is safe: tracked_files is intentionally stripped from the local
          // response. LocalCacheFile uses z.looseObject so the runtime shape is valid;
          // the static type just cannot express the intentional omission without a
          // separate type definition.
        } as unknown as InspectResult["value"],
      };
    }

    return {
      ok: true,
      value: {
        ...top.content,
        file: top.file,
        agent: args.agent,
      },
    };
  } catch (err) {
    const error = err as Error;
    return { ok: false, error: error.message, code: ErrorCode.UNKNOWN };
  }
}
