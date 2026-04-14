import { findRepoRoot, readCache } from "../cache/cacheManager.js";
import { resolveLocalCachePath } from "../cache/localCache.js";
import { LocalCacheFileSchema } from "../types/cache.js";
import type { MapArgs, MapDepth, MapResult } from "../types/commands.js";
import { ErrorCode, type Result } from "../types/result.js";
import { toUnknownResult } from "../errors.js";
import { normalizeFolderArg } from "../validation.js";

const MAP_MAX_BYTES = 20_000;

/**
 * Returns a semantic map view of local context cache content.
 *
 * @param args - {@link MapArgs} command arguments.
 * @returns Promise<Result<MapResult["value"]>>; common failures include FILE_NOT_FOUND,
 * PARSE_ERROR, FILE_READ_ERROR, PAYLOAD_TOO_LARGE, and UNKNOWN.
 */
export async function mapCommand(args: MapArgs): Promise<Result<MapResult["value"]>> {
  try {
    const depth: MapDepth = args.depth ?? "overview";
    const repoRoot = await findRepoRoot(process.cwd());
    let normalizedFolder: string | undefined;
    if (args.folder !== undefined) {
      const folderResult = normalizeFolderArg(args.folder);
      if (!folderResult.ok) return folderResult;
      normalizedFolder = folderResult.value;
    }

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
    const filteredFacts =
      normalizedFolder !== undefined
        ? Object.fromEntries(
            Object.entries(allFacts).filter(
              ([filePath]) => filePath === normalizedFolder || filePath.startsWith(`${normalizedFolder}/`),
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

    const value: MapResult["value"] = {
      depth,
      global_facts: parsed.global_facts ?? [],
      files,
      ...((depth === "modules" || depth === "full") && parsed.modules !== undefined ? { modules: parsed.modules } : {}),
      total_files: files.length,
      ...(normalizedFolder !== undefined ? { folder_filter: normalizedFolder } : {}),
    };

    const serialized = JSON.stringify(value);
    const serializedBytes = Buffer.byteLength(serialized, "utf8");
    if (serializedBytes > MAP_MAX_BYTES) {
      return {
        ok: false,
        error:
          `Map output is too large (${serializedBytes} bytes, limit ${MAP_MAX_BYTES} bytes). ` +
          "Use the folder parameter to restrict to a subdirectory, or use depth: overview instead of full.",
        code: ErrorCode.PAYLOAD_TOO_LARGE,
      };
    }

    return {
      ok: true,
      value,
    };
  } catch (err) {
    return toUnknownResult(err);
  }
}
