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
  global_facts: z.array(z.string()).optional(),
  facts: z.record(z.string(), z.array(z.string())).optional(),
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
  // Collect all Zod issues into one human-readable string
  const message = parsed.error.issues.map((i) => i.message).join("; ");
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
- Always join `parsed.error.issues.map(i => i.message)` for human-readable error messages
- The Zod schema is the single source of truth — derive TypeScript types from it with `z.infer<>`
- Never trust the shape of data read from disk, even from your own files
