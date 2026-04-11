import { findRepoRoot, readCache } from "../cache/cacheManager.js";
import { resolveLocalCachePath } from "../cache/localCache.js";
import { LocalCacheFileSchema } from "../types/cache.js";
import type { MapArgs, MapDepth, MapResult } from "../types/commands.js";
import { ErrorCode, type Result } from "../types/result.js";
import { toUnknownResult } from "../utils/errors.js";

export async function mapCommand(args: MapArgs): Promise<Result<MapResult["value"]>> {
  try {
    const depth: MapDepth = args.depth ?? "overview";
    const repoRoot = await findRepoRoot(process.cwd());
    const contextPath = resolveLocalCachePath(repoRoot);

    const readResult = await readCache(contextPath);
    if (!readResult.ok) {
      if (readResult.code === ErrorCode.FILE_NOT_FOUND) {
        return {
          ok: false,
          error: "context.json not found — run local-context-gatherer to populate the cache",
          code: ErrorCode.FILE_NOT_FOUND,
        };
      }
      return readResult;
    }

    const parseResult = LocalCacheFileSchema.safeParse(readResult.value);
    if (!parseResult.success) {
      return {
        ok: false,
        error: `Malformed local cache file: ${contextPath}`,
        code: ErrorCode.PARSE_ERROR,
      };
    }

    const parsed = parseResult.data;
    const allFacts = parsed.facts ?? {};
    const folderPrefix = args.folder;
    const filteredFacts =
      folderPrefix !== undefined
        ? Object.fromEntries(
            Object.entries(allFacts).filter(
              ([filePath]) => filePath === folderPrefix || filePath.startsWith(`${folderPrefix}/`),
            ),
          )
        : allFacts;

    const files = Object.entries(filteredFacts)
      .map(([path, fileFacts]) => ({
        path,
        ...(fileFacts.summary !== undefined ? { summary: fileFacts.summary } : {}),
        ...(fileFacts.role !== undefined ? { role: fileFacts.role } : {}),
        ...(fileFacts.importance !== undefined ? { importance: fileFacts.importance } : {}),
        ...(depth === "full" && fileFacts.facts !== undefined ? { facts: fileFacts.facts } : {}),
      }))
      .sort((a, b) => {
        const aImportance = a.importance ?? Number.POSITIVE_INFINITY;
        const bImportance = b.importance ?? Number.POSITIVE_INFINITY;
        if (aImportance !== bImportance) {
          return aImportance - bImportance;
        }
        return a.path.localeCompare(b.path);
      });

    return {
      ok: true,
      value: {
        depth,
        global_facts: parsed.global_facts ?? [],
        files,
        ...((depth === "modules" || depth === "full") && parsed.modules !== undefined
          ? { modules: parsed.modules }
          : {}),
        total_files: files.length,
        ...(args.folder !== undefined ? { folder_filter: args.folder } : {}),
      },
    };
  } catch (err) {
    return toUnknownResult(err);
  }
}
