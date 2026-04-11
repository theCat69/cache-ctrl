/**
 * Enumerates all typed failure categories returned by cache-ctrl commands and services.
 */
export enum ErrorCode {
  /** Returned when an expected cache file is absent on disk. */
  FILE_NOT_FOUND = "FILE_NOT_FOUND",
  /** Returned when a file cannot be read due to I/O or permission errors. */
  FILE_READ_ERROR = "FILE_READ_ERROR",
  /** Returned when a write, rename, delete, or other mutating file operation fails. */
  FILE_WRITE_ERROR = "FILE_WRITE_ERROR",
  /** Returned when file content is present but not valid JSON. */
  PARSE_ERROR = "PARSE_ERROR",

  /** Returned when advisory lock acquisition exceeds the configured wait timeout. */
  LOCK_TIMEOUT = "LOCK_TIMEOUT",
  /** Returned when lock file operations fail for reasons other than contention timeout. */
  LOCK_ERROR = "LOCK_ERROR",

  /** Returned when CLI arguments are missing, malformed, or violate command constraints. */
  INVALID_ARGS = "INVALID_ARGS",
  /** Returned when a destructive operation is requested without explicit confirmation. */
  CONFIRMATION_REQUIRED = "CONFIRMATION_REQUIRED",
  /** Returned when schema or structural validation fails for user-supplied content. */
  VALIDATION_ERROR = "VALIDATION_ERROR",

  /** Returned when keyword matching yields zero candidates. */
  NO_MATCH = "NO_MATCH",
  /** Returned when keyword matching yields multiple top-scoring candidates. */
  AMBIGUOUS_MATCH = "AMBIGUOUS_MATCH",

  /** Returned when a user-specified URL is not present in the matched entry's sources list. */
  URL_NOT_FOUND = "URL_NOT_FOUND",

  /** Returned for unexpected internal exceptions converted at command boundaries. */
  UNKNOWN = "UNKNOWN",
}

/**
 * Canonical failure payload used by the error branch of {@link Result}.
 */
export interface CacheError {
  code: ErrorCode;
  error: string;
}

/**
 * Discriminated union used for recoverable operation outcomes.
 *
 * @typeParam T - Success payload type carried when `ok` is `true`.
 * @typeParam E - Failure payload shape; defaults to {@link CacheError}.
 * @remarks Consumers must branch on `ok`. The success branch contains `value`; the
 * failure branch contains `error` and a typed `code`.
 */
export type Result<T, E extends CacheError = CacheError> =
  | { ok: true; value: T }
  | { ok: false; error: string; code: E["code"] };
