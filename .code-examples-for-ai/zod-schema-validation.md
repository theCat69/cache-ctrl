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
  header_metadata: z.record(z.string(), HeaderMetaSchema),
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
  // max 30 facts per file; each string ≤ 800 chars
  facts: z
    .record(
      z.string(),
      z
        .array(
          z.string().max(800, {
            message: "write concise observations, not file content (max 800 chars per fact)",
          }),
        )
        .max(30, {
          message: "max 30 facts per file — choose the most architecturally meaningful observations",
        }),
    )
    .optional(),
});

// Inferred TypeScript types from the Zod schemas — single source of truth
export type ExternalCacheFile = z.infer<typeof ExternalCacheFileSchema>;
export type LocalCacheFile = z.infer<typeof LocalCacheFileSchema>;
```

```typescript
// src/commands/write.ts — validation before writing an external cache entry

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
