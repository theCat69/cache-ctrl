import { z, type ZodError } from "zod";

import { ErrorCode, type Result, type ZodIssueSummary } from "./types/result.js";

/**
 * Regex for safe cache subject names.
 * First character must be alphanumeric — blocks pure-dot strings and dot-leading strings
 * that would otherwise enable relative path traversal (e.g. "../secrets", "..").
 */
const SUBJECT_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

/** Maximum allowed length for a cache subject. */
const SUBJECT_MAX_LENGTH = 128;

/** Maximum allowed length for a folder filter argument. */
const FOLDER_MAX_LENGTH = 512;

function summarizeZodIssue(issue: ZodError["issues"][number]): ZodIssueSummary {
  const path = issue.path.map((segment) => String(segment).replace(/[\x00-\x1f\x7f]/g, "?")).join(".");

  return {
    path,
    message: issue.message,
    code: issue.code,
    ...("expected" in issue && issue.expected !== undefined ? { expected: String(issue.expected) } : {}),
    ...("received" in issue && issue.received !== undefined
      ? { received: String(issue.received).replace(/[\x00-\x1f\x7f]/g, "?").slice(0, 200) }
      : {}),
    ...("options" in issue && Array.isArray(issue.options) ? { values: issue.options } : {}),
    ...("minimum" in issue && typeof issue.minimum === "number" ? { minimum: issue.minimum } : {}),
  };
}

/**
 * Builds a structured validation failure payload from a Zod error.
 */
export function buildZodFailure(
  error: ZodError,
  hint?: string,
): {
  ok: false;
  error: string;
  code: ErrorCode.VALIDATION_ERROR;
  issues: ZodIssueSummary[];
  hint?: string;
} {
  return {
    ok: false,
    error: z.prettifyError(error),
    code: ErrorCode.VALIDATION_ERROR,
    issues: error.issues.map(summarizeZodIssue),
    ...(hint !== undefined ? { hint } : {}),
  };
}

/**
 * Validates a cache subject string.
 * Rejects values that could enable path traversal (e.g. "../secrets") or inject
 * unexpected characters into file paths derived from the subject.
 */
export function validateSubject(subject: string): Result<void> {
  if (subject.length > SUBJECT_MAX_LENGTH) {
    return {
      ok: false,
      error: "Subject must be 128 characters or fewer",
      code: ErrorCode.INVALID_ARGS,
    };
  }
  if (!SUBJECT_PATTERN.test(subject)) {
    return {
      ok: false,
      error: `Invalid subject "${subject}": must match /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/`,
      code: ErrorCode.INVALID_ARGS,
    };
  }
  return { ok: true, value: undefined };
}

/**
 * Runtime guard for Zod `superRefine` contexts.
 *
 * @param value - Candidate refinement context value.
 * @returns Type predicate that confirms `value` exposes Zod-compatible `addIssue`.
 * @remarks This guard avoids unsafe assumptions when helper functions are reused outside
 * Zod's refinement pipeline.
 */
export function isRefinementContext(
  value: unknown,
): value is { addIssue: (issue: { code: "custom"; message: string; path: string[] }) => void } {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return typeof (value as Record<string, unknown>)["addIssue"] === "function";
}

/**
 * Rejects object keys that can be interpreted as traversal-capable file paths.
 *
 * @param record - Object whose keys are validated (for example `facts` map keys).
 * @param ctx - Zod refinement context used to report validation issues.
 * @remarks Security control: blocks keys containing `..`, leading `/`, `\\`, or `\x00`
 * to prevent path-traversal and null-byte injection when keys are later consumed as
 * filesystem-relative paths.
 */
export function rejectTraversalKeys(record: Record<string, unknown>, ctx: unknown): void {
  if (!isRefinementContext(ctx)) {
    return;
  }

  for (const key of Object.keys(record)) {
    if (key.includes("..") || key.startsWith("/") || key.includes("\\") || key.includes("\x00")) {
      ctx.addIssue({
        code: "custom",
        message: `facts key contains a path traversal or invalid character: "${key}"`,
        path: [key],
      });
    }
  }
}

/**
 * Normalizes and validates a folder filter argument used for path-prefix matching.
 */
export function normalizeFolderArg(folder: string): Result<string> {
  if (folder.length > FOLDER_MAX_LENGTH) {
    return {
      ok: false,
      error: `folder must be ${FOLDER_MAX_LENGTH} characters or fewer`,
      code: ErrorCode.INVALID_ARGS,
    };
  }

  const normalizedFolder = folder.replace(/\\/g, "/").replace(/\/+$/, "");

  if (normalizedFolder.length === 0) {
    return {
      ok: false,
      error: "folder must not be an empty string",
      code: ErrorCode.INVALID_ARGS,
    };
  }

  if (normalizedFolder.startsWith("/")) {
    return {
      ok: false,
      error: "folder must be a relative path",
      code: ErrorCode.INVALID_ARGS,
    };
  }

  if (normalizedFolder.includes("\x00")) {
    return {
      ok: false,
      error: "folder must not contain null bytes",
      code: ErrorCode.INVALID_ARGS,
    };
  }

  if (normalizedFolder.split("/").some((seg) => seg === "..")) {
    return {
      ok: false,
      error: "folder must not contain '..' path segments",
      code: ErrorCode.INVALID_ARGS,
    };
  }

  return { ok: true, value: normalizedFolder };
}
