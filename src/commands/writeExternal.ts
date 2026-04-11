import { join } from "node:path";

import { findRepoRoot, resolveCacheDir, writeCache } from "../cache/cacheManager.js";
import type { WriteArgs, WriteResult } from "../types/commands.js";
import { ExternalCacheFileSchema } from "../types/cache.js";
import { ErrorCode, type Result } from "../types/result.js";
import { toUnknownResult } from "../utils/errors.js";
import { formatZodError, validateSubject } from "../utils/validate.js";

export async function writeExternalCommand(args: WriteArgs): Promise<Result<WriteResult["value"]>> {
  try {
    if (!args.subject) {
      return { ok: false, error: "subject is required for external agent", code: ErrorCode.INVALID_ARGS };
    }

    const subjectValidation = validateSubject(args.subject);
    if (!subjectValidation.ok) return subjectValidation;

    if (args.content["subject"] !== undefined && args.content["subject"] !== args.subject) {
      return {
        ok: false,
        error: `content.subject "${String(args.content["subject"])}" does not match subject argument "${args.subject}"`,
        code: ErrorCode.VALIDATION_ERROR,
      };
    }

    const contentWithSubject = { ...args.content, subject: args.subject };

    const parsed = ExternalCacheFileSchema.safeParse(contentWithSubject);
    if (!parsed.success) {
      const message = formatZodError(parsed.error);
      return { ok: false, error: `Validation failed: ${message}`, code: ErrorCode.VALIDATION_ERROR };
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
