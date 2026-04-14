# Subject input validation — regex guard + max-length + Result<void> return

## Pattern: validate string inputs that become file path components before any filesystem use

`validateSubject()` demonstrates the pattern for all string inputs that feed into file paths.
The first-char-alphanumeric rule is a deliberate security constraint, not just cosmetic validation.

```typescript
// src/validation.ts

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
 * Validates a cache subject string.
 * Rejects values that could enable path traversal (e.g. "../secrets") or inject
 * unexpected characters into file paths derived from the subject.
 *
 * @param subject - The raw subject string to validate
 * @returns `{ ok: true }` on success, or `{ ok: false, code, error }` on failure
 */
export function validateSubject(subject: string): Result<void> {
  // Length check first — cheap, before regex evaluation
  if (subject.length > SUBJECT_MAX_LENGTH) {
    return {
      ok: false,
      error: "Subject must be 128 characters or fewer",
      code: ErrorCode.INVALID_ARGS,
    };
  }
  // Pattern check — rejects path traversal, shell metacharacters, slashes
  if (!SUBJECT_PATTERN.test(subject)) {
    return {
      ok: false,
      error: `Invalid subject "${subject}": must match /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/`,
      code: ErrorCode.INVALID_ARGS,
    };
  }
  return { ok: true, value: undefined };  // void success
}
```

## Usage at the call site

```typescript
// src/commands/writeExternal.ts — validate before any file path construction
const subjectValidation = validateSubject(args.subject);
if (!subjectValidation.ok) return subjectValidation;  // propagate as-is

// Safe to use args.subject in a file path now
const filePath = join(cacheDir, `${args.subject}.json`);
```

## Security rationale for the pattern

| Input | Blocked by | Reason |
|---|---|---|
| `../secrets` | first-char rule | starts with `.` |
| `..` | first-char rule | starts with `.` |
| `.hidden` | first-char rule | starts with `.` |
| `foo/bar` | pattern | `/` not in allowed set |
| `foo;rm -rf` | pattern | `;` not in allowed set |
| `a`.repeat(200) | length check | exceeds 128 chars |
| `valid-subject_1.0` | passes | all chars allowed |

## Key rules

- Run length check before regex — fail fast on obviously bad inputs
- Include the failed value in the error message so callers can diagnose without re-running
- Use `ErrorCode.INVALID_ARGS` for all user-supplied input validation failures
- Return `{ ok: true, value: undefined }` for `Result<void>` — never return `{ ok: true }` without a `value` field
- Validate at the command boundary before any downstream service receives the value
