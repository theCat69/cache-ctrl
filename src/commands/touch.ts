import { findRepoRoot, listCacheFiles, writeCache } from "../cache/cacheManager.js";
import { resolveTopExternalMatch } from "../cache/externalCache.js";
import { resolveLocalCachePath } from "../cache/localCache.js";
import { ErrorCode, type Result } from "../types/result.js";
import type { TouchArgs, TouchResult } from "../types/commands.js";
import { validateSubject } from "../utils/validate.js";

export async function touchCommand(args: TouchArgs): Promise<Result<TouchResult["value"]>> {
  try {
    const repoRoot = await findRepoRoot(process.cwd());
    const newTimestamp = new Date().toISOString();
    const touched: string[] = [];

    if (args.agent === "external") {
      let filesToTouch: string[];

      if (args.subject) {
        const subjectCheck = validateSubject(args.subject);
        if (!subjectCheck.ok) return subjectCheck;
        const matchResult = await resolveTopExternalMatch(repoRoot, args.subject);
        if (!matchResult.ok) return matchResult;
        filesToTouch = [matchResult.value];
      } else {
        const filesResult = await listCacheFiles("external", repoRoot);
        if (!filesResult.ok) return filesResult;
        filesToTouch = filesResult.value;
      }

      for (const filePath of filesToTouch) {
        const writeResult = await writeCache(filePath, { fetched_at: newTimestamp });
        if (!writeResult.ok) return writeResult;
        touched.push(filePath);
      }
    } else {
      // local
      const localPath = resolveLocalCachePath(repoRoot);
      const writeResult = await writeCache(localPath, { timestamp: newTimestamp });
      if (!writeResult.ok) return writeResult;
      touched.push(localPath);
    }

    return { ok: true, value: { touched, new_timestamp: newTimestamp } };
  } catch (err) {
    const error = err as Error;
    return { ok: false, error: error.message, code: ErrorCode.UNKNOWN };
  }
}
