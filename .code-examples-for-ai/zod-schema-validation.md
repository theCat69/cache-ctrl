# Zod schema validation at write boundaries — safeParse() with Result<T> error return

## Pattern: Validate all external JSON with Zod safeParse before any write

All data crossing a trust boundary (CLI input, disk reads, agent-provided payloads) is validated
against a Zod schema before being written to disk. Always use `safeParse()` — never `parse()`.

```typescript
// src/types/cache.ts — schema definitions using z.looseObject() to preserve unknown fields

import { z } from "zod";

// z.looseObject() allows extra fields to pass through (important for forward-compat merge)
export const ExternalCacheFileSchema = z.looseObject({
  subject: z.string(),
  description: z.string(),
  fetched_at: z.string(),
  sources: z.array(SourceSchema),
});

const FileFactsSchema = z.object({
  summary: z.string().max(300).optional(),
  role: z
    .enum(["entry-point", "interface", "implementation", "test", "config"])
    .optional(),
  importance: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  facts: z.array(z.string().max(300)).max(10).optional(),
});

export const LocalCacheFileSchema = z.looseObject({
  timestamp: z.string(),
  topic: z.string(),
  description: z.string(),
  cache_miss_reason: z.string().optional(),
  tracked_files: z.array(TrackedFileSchema),
  // max 20 entries; each string ≤ 300 chars
  global_facts: z
    .array(
      z.string().max(300, {
        message: "global facts must be concise cross-cutting observations (max 300 chars)",
      }),
    )
    .max(20, {
      message: "max 20 global facts — choose only cross-cutting structural observations",
    })
    .optional(),
  facts: z.record(z.string(), FileFactsSchema).optional(),
});

// Inferred TypeScript types from the Zod schemas — single source of truth
export type ExternalCacheFile = z.infer<typeof ExternalCacheFileSchema>;
export type LocalCacheFile = z.infer<typeof LocalCacheFileSchema>;
```

```typescript
// src/commands/writeExternal.ts — validation before writing an external cache entry

// Step 1: validate the subject (path traversal guard)
const subjectValidation = validateSubject(args.subject);
if (!subjectValidation.ok) return subjectValidation;

// Step 2: inject required fields before schema validation
const contentWithSubject = { ...args.content, subject: args.subject };

// Step 3: safeParse — never parse() which would throw
const parsed = ExternalCacheFileSchema.safeParse(contentWithSubject);
if (!parsed.success) {
  // Collect all Zod issues into one human-readable string, prefixed with the field path.
  // Sanitize path segments to strip control characters (segments can include user-supplied keys).
  const message = parsed.error.issues
    .map((i) => {
      if (i.path.length === 0) return i.message;
      const pathStr = i.path.map((seg) => String(seg).replace(/[\x00-\x1f\x7f]/g, "?")).join(".");
      return `${pathStr}: ${i.message}`;
    })
    .join("; ");
  return { ok: false, error: `Validation failed: ${message}`, code: ErrorCode.VALIDATION_ERROR };
}
// parsed.data is now fully typed and safe to use
```

```typescript
// Reading from disk: validate on the way in, skip silently on schema mismatch with a warning

const readResult = await readCache(filePath);
if (!readResult.ok) continue;   // skip unreadable files

const parseResult = ExternalCacheFileSchema.safeParse(readResult.value);
if (!parseResult.success) {
  // Emit warning but don't crash — malformed cache files are degraded gracefully
  process.stderr.write(`[cache-ctrl] Warning: skipping malformed external cache file: ${filePath}\n`);
  continue;
}
const data = parseResult.data;   // fully typed ExternalCacheFile
```

## Key rules

- `z.looseObject()` for cache file schemas — preserves unknown fields through atomic merge
- `z.object()` (strict) for internal value objects like `TrackedFileSchema`
- Error messages include the Zod issue path: `parsed.error.issues.map(i => i.path.length > 0 ? \`${sanitizedPath}: ${i.message}\` : i.message)` — sanitize path segments with `.replace(/[\x00-\x1f\x7f]/g, "?")` before joining
- The Zod schema is the single source of truth — derive TypeScript types from it with `z.infer<>`
- Never trust the shape of data read from disk, even from your own files

## Pattern: structured validation failures for CLI self-correction

When validation fails, return a machine-friendly error with both a human string and per-issue fields.

```typescript
// src/validation.ts
import { z, type ZodError } from "zod";
import { ErrorCode, type ZodIssueSummary } from "./types/result.js";

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
    issues: error.issues.map((issue) => ({
      path: issue.path.map((segment) => String(segment).replace(/[\x00-\x1f\x7f]/g, "?")).join("."),
      message: issue.message,
      code: issue.code,
      ...("expected" in issue && issue.expected !== undefined ? { expected: String(issue.expected) } : {}),
      ...("received" in issue && issue.received !== undefined ? { received: String(issue.received) } : {}),
      ...("values" in issue && issue.values !== undefined ? { values: issue.values } : {}),
      ...("minimum" in issue && typeof issue.minimum === "number" ? { minimum: issue.minimum } : {}),
    })),
    ...(hint !== undefined ? { hint } : {}),
  };
}
```

```typescript
// src/index.ts (dispatch boundary)
const parsed = WriteExternalInputSchema.safeParse(parsedData);
if (!parsed.success) {
  printError(buildZodFailure(parsed.error, WRITE_EXTERNAL_HINT), pretty);
  process.exit(1);
}
```
