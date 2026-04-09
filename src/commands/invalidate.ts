import { findRepoRoot, listCacheFiles, writeCache, readCache } from "../cache/cacheManager.js";
import { resolveTopExternalMatch } from "../cache/externalCache.js";
import { resolveLocalCachePath } from "../cache/localCache.js";
import { ErrorCode, type Result } from "../types/result.js";
import type { InvalidateArgs, InvalidateResult } from "../types/commands.js";
import { validateSubject } from "../utils/validate.js";

export async function invalidateCommand(args: InvalidateArgs): Promise<Result<InvalidateResult["value"]>> {
  try {
    const repoRoot = await findRepoRoot(process.cwd());
    const invalidated: string[] = [];

    if (args.agent === "external") {
      let filesToInvalidate: string[];

      if (args.subject) {
        const subjectCheck = validateSubject(args.subject);
        if (!subjectCheck.ok) return subjectCheck;
        const matchResult = await resolveTopExternalMatch(repoRoot, args.subject);
        if (!matchResult.ok) return matchResult;
        filesToInvalidate = [matchResult.value];
      } else {
        const filesResult = await listCacheFiles("external", repoRoot);
        if (!filesResult.ok) return filesResult;
        filesToInvalidate = filesResult.value;
      }

      for (const filePath of filesToInvalidate) {
        const writeResult = await writeCache(filePath, { fetched_at: "" });
        if (!writeResult.ok) return writeResult;
        invalidated.push(filePath);
      }
    } else {
      // local — only invalidate if the file already exists
      const localPath = resolveLocalCachePath(repoRoot);
      const readResult = await readCache(localPath);
      if (!readResult.ok) {
        if (readResult.code === ErrorCode.FILE_NOT_FOUND) {
          return { ok: false, error: `Local cache file not found: ${localPath}`, code: ErrorCode.FILE_NOT_FOUND };
        }
        return readResult;
      }
      const writeResult = await writeCache(localPath, { timestamp: "" });
      if (!writeResult.ok) return writeResult;
      invalidated.push(localPath);
    }

    return { ok: true, value: { invalidated } };
  } catch (err) {
    const error = err as Error;
    return { ok: false, error: error.message, code: ErrorCode.UNKNOWN };
  }
}
