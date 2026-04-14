---
name: project-security
description: Project-specific security guidelines for secrets, input validation, dependencies, auth, and common vulnerabilities
---

# Project Security Guidelines

`cache-ctrl` is a CLI tool that reads and writes files on behalf of AI agents. Its attack surface is the file system and the subject/data inputs passed via CLI arguments. Every input crossing a trust boundary must be validated.

---

## Secrets Management

- **No secrets belong in cache files.** The `.ai/` directory is gitignored but never treat it as a secrets store.
- Environment variables that contain credentials must never be written to any cache file structure.
- The `subject` field in external cache entries becomes part of a file path. Treat it as untrusted user input even when it arrives from an AI agent.
- Never log or emit full file contents to stderr/stdout in error paths — only emit file paths and error codes.

---

## Input Validation

### Subject Validation (Path Traversal Prevention)

All subject strings that become file path components must pass through `validateSubject()` in `src/validation.ts` before any file operation:

```typescript
// SUBJECT_PATTERN blocks pure-dot strings ("..", ".") and dot-leading strings
// that would enable relative path traversal (e.g. "../secrets").
// First char must be alphanumeric — blocks all traversal via leading dots.
const SUBJECT_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const SUBJECT_MAX_LENGTH = 128;
```

Rules enforced:
- First character must be alphanumeric — blocks `../secrets`, `..`, `.hidden`
- Only `a-z`, `A-Z`, `0-9`, `.`, `_`, `-` allowed — no slashes, colons, or shell metacharacters
- Maximum 128 characters — prevents excessively long file names

### Path Traversal Guard for Tracked Files

All paths stored in `tracked_files` are resolved through `resolveTrackedFilePath()` in `src/files/changeDetector.ts` before any `lstat()`, `readFile()`, or write operation:

```typescript
export function resolveTrackedFilePath(inputPath: string, repoRoot: string): string | null {
  const resolved = isAbsolute(inputPath) ? resolve(inputPath) : resolve(repoRoot, inputPath);
  const normalizedRoot = repoRoot.endsWith("/") ? repoRoot : repoRoot + "/";
  // Rejects any path that resolves outside the repo root
  if (!resolved.startsWith(normalizedRoot) && resolved !== repoRoot) {
    return null; // path traversal rejected — caller must treat as missing
  }
  return resolved;
}
```

Never call filesystem operations on user-supplied paths without first running them through this guard.

### Zod Schema Validation at All Entry Points

Every JSON payload written to or read from disk must be validated against the appropriate Zod schema:

- `ExternalCacheFileSchema` for external agent cache files
- `LocalCacheFileSchema` for local agent cache files
- `TrackedFileSchema.array()` for the `tracked_files` array on read

Use `safeParse()` — never `parse()` (which throws). On failure, return `{ ok: false, code: ErrorCode.VALIDATION_ERROR, error: message }`.

### CLI Argument Validation

Validate all `--agent` values before routing. The `agent` argument must be exactly `"external"` or `"local"` (or `"all"` where applicable). Reject with `usageError()` on unrecognized values — this calls `process.exit(2)` without emitting sensitive data.

---

## Dependency Security

- **Minimal dependency surface**: only `zod` (schema validation) and `@opencode-ai/plugin` (runtime integration) are production dependencies.
- Keep dependencies pinned to exact versions in `package.json` (`zod: "4.3.6"`, `vitest: "4.1.2"`).
- Run `bun audit` (or equivalent) before releasing a new version.
- Do not add runtime dependencies without evaluating transitive dependency risk.

---

## Authentication & Authorization

This tool has no authentication layer — it is designed for local developer/agent use only. Security controls are:

1. **File system permissions** — cache files are readable/writable only by the current user (OS-enforced)
2. **Repo-root anchoring** — all paths are resolved relative to the git repo root, preventing escapes
3. **Advisory locking** — prevents concurrent write corruption but is not a security boundary

Do not expose `cache-ctrl` over a network interface or in a multi-tenant environment without adding explicit access controls.

---

## Common Vulnerabilities

### Path Traversal (CWE-22)

**Mitigated by**:
- `resolveTrackedFilePath()` returning `null` for out-of-bounds paths
- `validateSubject()` rejecting dot-leading and slash-containing strings
- All `null` returns treated as missing/rejected, never followed

**Test for**:
```
subject: "../secrets"           → rejected by validateSubject()
tracked_files path: "../../etc" → rejected by resolveTrackedFilePath()
```

### Race Conditions / TOCTOU (CWE-367)

**Mitigated by**:
- Advisory locking with `O_EXCL` atomic create in `acquireLock()`
- Atomic write via temp file + `rename()` in `writeCache()`
- Stale lock detection by age (30 s) and PID liveness check

### Prototype Pollution (CWE-1321)

**Mitigated by**:
- All external JSON parsed with Zod schemas that have defined shapes
- `z.looseObject()` passes extra fields through but never `eval`s or merges into prototypes
- No use of `Object.assign` with untrusted data; spread syntax (`{ ...existing, ...updates }`) is safe

### Arbitrary File Write

**Mitigated by**:
- Subject → filename mapping only within `.ai/<agent>_cache/<subject>.json` (validated by `validateSubject()`)
- `tracked_files` write operations are read-only filesystem probes (lstat/readFile), never writes
- `writeCache()` only writes to paths derived from `resolveCacheDir()` — never to caller-supplied paths
