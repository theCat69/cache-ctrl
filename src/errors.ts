import { ErrorCode } from "./types/result.js";

/**
 * Converts an unknown thrown value into the canonical UNKNOWN result shape.
 *
 * @param err - Untrusted thrown value caught at a command boundary.
 * @returns `Result<never>`-compatible failure payload with {@link ErrorCode.UNKNOWN}.
 * @remarks This is the canonical catch-all converter used by command handlers to avoid
 * leaking thrown exceptions across the Result-based API boundary.
 */
export function toUnknownResult(err: unknown): { ok: false; error: string; code: ErrorCode.UNKNOWN } {
  const error = err instanceof Error ? err.message : String(err);
  return { ok: false, error, code: ErrorCode.UNKNOWN };
}
