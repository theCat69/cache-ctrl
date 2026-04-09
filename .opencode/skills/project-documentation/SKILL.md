---
name: project-documentation
description: Project-specific documentation standards for code, README, API docs, and changelog
---

# Project Documentation Standards

`cache-ctrl` is a developer tool consumed by AI agents. Documentation must be precise, technical, and immediately actionable. The README is the primary reference — it is the contract between the tool and its callers.

---

## Code Documentation

### Public APIs — TSDoc

All exported functions and types must have TSDoc comments. Use `@param`, `@returns`, and `@throws` where applicable:

```typescript
/**
 * Validates a cache subject string.
 * Rejects values that could enable path traversal (e.g. "../secrets") or inject
 * unexpected characters into file paths derived from the subject.
 *
 * @param subject - The subject string to validate (max 128 chars, alphanumeric + `.`, `_`, `-`)
 * @returns `{ ok: true }` on success, or `{ ok: false, code, error }` on validation failure
 */
export function validateSubject(subject: string): Result<void> { ... }
```

### Internal Logic — Why, Not What

Comment the *reason* for non-obvious decisions, not what the code does:

```typescript
// lstat: mtime reflects the symlink node, not the target; hash check covers content
// drift when hash is stored — this prevents false-positives from touch operations
const fileStat = await lstat(absolutePath);
```

Do **not** comment obvious code:
```typescript
// Bad: "iterate over files" comment on a for-loop
// Bad: "return result" comment on a return statement
```

### Inline Security Comments

Any code that implements a security control (path traversal guard, subject regex, lock acquisition) must have a comment explaining the threat it mitigates:

```typescript
/**
 * Returns null if the resolved path escapes the repo root (path traversal guard).
 */
export function resolveTrackedFilePath(inputPath: string, repoRoot: string): string | null { ... }
```

---

## README Format

The `README.md` is comprehensive and serves as the authoritative reference. It includes:

1. **Overview** — what the tool does, who uses it (AI agent context caching)
2. **Installation** — `install.sh` instructions
3. **Architecture** — cache structure, agent types, directory layout
4. **CLI Reference** — every command with flags, arguments, and output format
5. **Cache Schemas** — JSON structure for `ExternalCacheFile` and `LocalCacheFile`
6. **Error Codes** — all `ErrorCode` enum values with descriptions
7. **Examples** — real command-line usage examples

When adding a new command or flag, update all relevant sections in the README in the same PR.

---

## API Documentation

The tool exposes no HTTP API. The "API" is the CLI surface and the JSON structures it reads/writes.

- Document any new `Args` or `Result` types in `src/types/commands.ts` with TSDoc
- Document schema changes in both `src/types/cache.ts` (code) and `README.md` (prose)
- The Zod schemas in `src/types/cache.ts` are the ground truth for the cache file format

---

## Changelog

No `CHANGELOG.md` currently exists. If one is added, follow **Keep a Changelog** format:

```markdown
## [Unreleased]
### Added
- `cache-ctrl write` command with per-path merge semantics for local agent

### Fixed
- Path traversal guard now correctly rejects symlink-based escape attempts
```

Keep entries concise and user-focused. Reference relevant `ErrorCode` values or command names where applicable.
