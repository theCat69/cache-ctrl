import { join } from "node:path";

import { findRepoRoot, resolveCacheDir, writeCache } from "../cache/cacheManager.js";
import type { WriteArgs, WriteResult } from "../types/commands.js";
import { ExternalCacheFileSchema, WriteExternalInputSchema } from "../types/cache.js";
import { ErrorCode, type Result } from "../types/result.js";
import { toUnknownResult } from "../errors.js";
import { buildZodFailure, validateSubject } from "../validation.js";

/**
 * Validates and writes one external cache entry.
 *
 * @param args - {@link WriteArgs} command arguments for the external agent.
 * @returns Promise<Result<WriteResult["value"]>>; common failures include INVALID_ARGS,
 * VALIDATION_ERROR, FILE_WRITE_ERROR, LOCK_TIMEOUT/LOCK_ERROR, and UNKNOWN.
 */
export async function writeExternalCommand(args: WriteArgs): Promise<Result<WriteResult["value"]>> {
  try {
    if (!args.subject) {
      return { ok: false, error: "subject is required for external agent", code: ErrorCode.INVALID_ARGS };
    }

    const subjectValidation = validateSubject(args.subject);
    if (!subjectValidation.ok) return subjectValidation;

    const inputParse = WriteExternalInputSchema.safeParse(args.content);
    if (!inputParse.success) {
      return buildZodFailure(inputParse.error);
    }

    if (args.content["subject"] !== undefined && args.content["subject"] !== args.subject) {
      return {
        ok: false,
        error: `content.subject "${String(args.content["subject"])}" does not match subject argument "${args.subject}"`,
        code: ErrorCode.VALIDATION_ERROR,
      };
    }

    const contentWithSubject = { ...inputParse.data, subject: args.subject };

    const parsed = ExternalCacheFileSchema.safeParse(contentWithSubject);
    if (!parsed.success) {
      return buildZodFailure(parsed.error);
    }

    const repoRoot = await findRepoRoot(process.cwd());
    const cacheDir = resolveCacheDir("external", repoRoot);
    const filePath = join(cacheDir, `${args.subject}.json`);
    const writeResult = await writeCache(filePath, contentWithSubject);
    if (!writeResult.ok) return writeResult;
    return { ok: true, value: { file: filePath } };
  } catch (err) {
    return toUnknownResult(err);
  }
}
