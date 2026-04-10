export enum ErrorCode {
  // File system errors
  FILE_NOT_FOUND = "FILE_NOT_FOUND",
  FILE_READ_ERROR = "FILE_READ_ERROR",
  FILE_WRITE_ERROR = "FILE_WRITE_ERROR",
  PARSE_ERROR = "PARSE_ERROR",

  // Lock errors
  LOCK_TIMEOUT = "LOCK_TIMEOUT",
  LOCK_ERROR = "LOCK_ERROR",

  // Validation errors
  INVALID_ARGS = "INVALID_ARGS",
  CONFIRMATION_REQUIRED = "CONFIRMATION_REQUIRED",
  VALIDATION_ERROR = "VALIDATION_ERROR",

  // Search/match errors
  NO_MATCH = "NO_MATCH",
  AMBIGUOUS_MATCH = "AMBIGUOUS_MATCH",

  // HTTP errors
  HTTP_REQUEST_FAILED = "HTTP_REQUEST_FAILED",
  URL_NOT_FOUND = "URL_NOT_FOUND",

  // Internal
  UNKNOWN = "UNKNOWN",
}

export interface CacheError {
  code: ErrorCode;
  error: string;
}

export type Result<T, E extends CacheError = CacheError> =
  | { ok: true; value: T }
  | { ok: false; error: string; code: E["code"] };
