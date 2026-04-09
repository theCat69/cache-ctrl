---
name: project-coding
description: Project-specific coding guidelines, naming conventions, architecture patterns, and code examples
---

# Project Coding Guidelines

This project is a **TypeScript CLI tool** (`cache-ctrl`) that runs on **Bun 1.x**. It manages AI context caches via a command layer backed by a set of core services. Every change targets a production CLI consumed by AI agents — correctness and type safety are non-negotiable.

---

## Code Style

- **TypeScript strict mode** is mandatory. The `tsconfig.json` enables `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and `verbatimModuleSyntax`. Never relax these flags.
- Target `ESNext` with `moduleResolution: "bundler"` — modern syntax everywhere, no CommonJS patterns.
- All files use ESM `.js` extensions in import paths (Bun resolves `.ts` from `.js` imports): `import { foo } from "./bar.js"`.
- `verbatimModuleSyntax` is on — always use `import type { ... }` for type-only imports.
- Prefer `unknown` over `any`. When `any` is genuinely unavoidable, document why with an inline comment.
- Use `as const` to freeze literal values. Use `satisfies` to validate without widening.
- No type assertions (`value as SomeType`) except when bridging intentionally incompatible types; document every exception.

---

## Naming Conventions

| Entity | Convention | Example |
|---|---|---|
| Files | camelCase | `changeDetector.ts`, `cacheManager.ts` |
| Functions | camelCase verb phrase | `writeCommand`, `validateSubject`, `findRepoRoot` |
| Types & Interfaces | PascalCase | `CacheError`, `TrackedFile`, `WriteResult` |
| Enums | PascalCase name, SCREAMING_SNAKE members | `ErrorCode.FILE_NOT_FOUND` |
| Zod schemas | PascalCase + `Schema` suffix | `ExternalCacheFileSchema`, `TrackedFileSchema` |
| Constants | SCREAMING_SNAKE_CASE | `LOCK_TIMEOUT_MS`, `SUBJECT_MAX_LENGTH` |
| Boolean vars | `is`, `has`, `can` prefix | `isStale`, `hasPermission` |
| Command handlers | `<verb>Command` | `listCommand`, `inspectCommand` |

Avoid generic names: `data`, `value`, `temp`, `result`, `obj`, `info`. When a name is hard to find, the abstraction is wrong — redesign it.

---

## Import Ordering

1. Node built-ins (`node:fs/promises`, `node:path`, `node:crypto`)
2. Third-party packages (`zod`)
3. Internal — types (`../types/result.js`, `../types/cache.js`)
4. Internal — services (`../cache/cacheManager.js`, `../files/changeDetector.js`)
5. Internal — utilities (`../utils/validate.js`)

Group each tier with a blank line separator. Use `import type` for all type-only imports.

```typescript
import { readFile, lstat } from "node:fs/promises";
import { createHash } from "node:crypto";

import { z } from "zod";

import type { TrackedFile } from "../types/cache.js";
import { ErrorCode, type Result } from "../types/result.js";

import { validateSubject } from "../utils/validate.js";
```

---

## Error Handling

- **Result<T, E> pattern** is the project standard for all recoverable errors. Never `throw` for expected failure modes.
- Unrecoverable programmer errors (truly exceptional bugs) may use `throw` — wrap in a top-level catch in `main()`.
- Every `Result` carries a typed `ErrorCode` member. Always pick the most specific code from `src/types/result.ts`.
- Never silently swallow errors. `catch (err) {}` is a bug.
- Error messages must be actionable — state what failed and what the caller can do.
- CLI commands exit with code `1` on error and emit JSON to stderr. Exit `2` for usage errors (`usageError`).

```typescript
// Good — explicit, typed Result
export async function validateSubject(subject: string): Result<void> {
  if (!SUBJECT_PATTERN.test(subject)) {
    return { ok: false, error: `Invalid subject "${subject}": ...`, code: ErrorCode.INVALID_ARGS };
  }
  return { ok: true, value: undefined };
}

// Good — propagate upstream without re-wrapping
const subjectValidation = validateSubject(args.subject);
if (!subjectValidation.ok) return subjectValidation;
```

---

## Patterns & Architecture

### Command Layer (`src/commands/`)

Each CLI subcommand maps to a single `<verb>Command(args)` function in its own file. Commands:
- Accept a typed `Args` interface from `src/types/commands.ts`.
- Return `Promise<Result<T>>`.
- Delegate all I/O to services — no direct filesystem calls inside commands.
- Call `findRepoRoot(process.cwd())` at the start to anchor all paths.

```typescript
export async function listCommand(args: ListArgs): Promise<Result<ListResult["value"]>> {
  try {
    const repoRoot = await findRepoRoot(process.cwd());
    // ... delegate to cacheManager, externalCache, etc.
    return { ok: true, value: entries };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg, code: ErrorCode.UNKNOWN };
  }
}
```

### Services (`src/cache/`, `src/files/`, `src/http/`, `src/search/`)

Pure service modules with no knowledge of CLI concerns. Each has a single cohesive responsibility:
- `cacheManager.ts` — file I/O, advisory locking, directory resolution
- `changeDetector.ts` — mtime/hash comparison, path traversal guard
- `externalCache.ts` — external entry helpers (staleness, age formatting, file stem)
- `localCache.ts` — local entry path resolution

### Zod Validation at Boundaries

All external data (JSON from disk, CLI `--data` input) is validated with Zod before use. Parse with `safeParse()` — never `parse()` (throws on failure). Loosen schemas for cache files use `z.looseObject()` to preserve unknown fields during atomic merge.

```typescript
const parsed = ExternalCacheFileSchema.safeParse(contentWithSubject);
if (!parsed.success) {
  const message = parsed.error.issues.map((i) => i.message).join("; ");
  return { ok: false, error: `Validation failed: ${message}`, code: ErrorCode.VALIDATION_ERROR };
}
```

### Advisory File Locking

`writeCache()` in `cacheManager.ts` acquires an advisory lock (`O_EXCL` atomic create) before any write. This prevents race conditions when multiple processes write the same cache file simultaneously. The lock is always released in a `finally` block.

### Atomic Writes

Cache files are written via a `rename()` strategy: write to a temp file (`<file>.tmp.<pid>.<random>`), then rename atomically. This ensures readers never see a partial write.

### Path Traversal Guard

`resolveTrackedFilePath()` in `changeDetector.ts` rejects any path that resolves outside the repo root. Always pass user-supplied paths through this guard before any filesystem operation.

---

## Code Examples

See `.code-examples-for-ai/` for concrete snippets:

| Pattern | File |
|---|---|
| Result<T, E> discriminated union | `result-pattern.md` |
| Zod schema validation at boundaries | `zod-schema-validation.md` |
| Command handler structure | `command-handler.md` |
| Async file comparison with Promise.all | `change-detector.md` |
| Subject input validation + ErrorCode | `subject-validation.md` |
