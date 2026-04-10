import type { ZodError } from "zod";

import { ErrorCode, type Result } from "../types/result.js";

/**
 * Regex for safe cache subject names.
 * First character must be alphanumeric — blocks pure-dot strings and dot-leading strings
 * that would otherwise enable relative path traversal (e.g. "../secrets", "..").
 */
const SUBJECT_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

/** Maximum allowed length for a cache subject. */
const SUBJECT_MAX_LENGTH = 128;

/**
 * Formats a ZodError's issues into a human-readable semicolon-separated string.
 * Each issue is prefixed with its dot-separated field path when present.
 */
export function formatZodError(error: ZodError): string {
  return error.issues
    .map((i) => {
      if (i.path.length === 0) return i.message;
      const pathStr = i.path.map((seg) => String(seg).replace(/[\x00-\x1f\x7f]/g, "?")).join(".");
      return `${pathStr}: ${i.message}`;
    })
    .join("; ");
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
