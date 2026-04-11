import { ErrorCode } from "../types/result.js";

export function toUnknownResult(err: unknown): { ok: false; error: string; code: ErrorCode.UNKNOWN } {
  const error = err instanceof Error ? err.message : String(err);
  return { ok: false, error, code: ErrorCode.UNKNOWN };
}
