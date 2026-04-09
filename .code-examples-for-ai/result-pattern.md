# Result<T, E> discriminated union pattern used throughout the project for recoverable errors

## Pattern: Result<T, E> — typed error returns without throwing

All command functions and service methods return `Result<T>` instead of throwing for expected failure modes.
This makes every failure path explicit and type-safe at the call site.

```typescript
// src/types/result.ts

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
  INVALID_AGENT = "INVALID_AGENT",
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

// The discriminated union: ok: true carries the value, ok: false carries the error
export type Result<T, E extends CacheError = CacheError> =
  | { ok: true; value: T }
  | { ok: false; error: string; code: E["code"] };
```

## Usage: returning errors

```typescript
// Return a typed error — never throw for expected failures
export function validateSubject(subject: string): Result<void> {
  if (!SUBJECT_PATTERN.test(subject)) {
    return {
      ok: false,
      error: `Invalid subject "${subject}": must match /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/`,
      code: ErrorCode.INVALID_ARGS,    // always pick the most specific code
    };
  }
  return { ok: true, value: undefined };  // void success uses value: undefined
}
```

## Usage: propagating errors upstream

```typescript
// Early-return propagation — no re-wrapping needed
const subjectValidation = validateSubject(args.subject);
if (!subjectValidation.ok) return subjectValidation;  // ← propagate as-is
```

## Usage: type narrowing at call sites

```typescript
const result = await writeCommand({ agent, subject, content });
if (!result.ok) {
  printError(result, pretty);          // result.error and result.code are accessible here
  process.exit(1);
}
// result.value is now accessible (type narrowed to the success branch)
printResult(result, pretty);
```

## Key rules

- Use `throw` only for truly unrecoverable programmer errors
- Always wrap top-level `main()` with a `catch` that converts thrown errors to `Result`-shaped JSON
- Never mix error state with valid return values (no `null` returns from functions that should signal errors)
- Catch-all in commands:
  ```typescript
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg, code: ErrorCode.UNKNOWN };
  }
  ```
