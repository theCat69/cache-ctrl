# Async file comparison with parallel Promise.all and path traversal guard

## Pattern: parallel lstat/hash checks with resolveTrackedFilePath() guard

`changeDetector.ts` demonstrates three key patterns:
1. Path traversal guard — resolve paths against repo root, reject escapes
2. mtime-first, hash-fallback comparison — avoids expensive SHA-256 when mtime unchanged
3. `Promise.all()` for concurrent stat + hash on multiple files

```typescript
// src/files/changeDetector.ts

import { readFile, lstat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, isAbsolute } from "node:path";
import type { TrackedFile } from "../types/cache.js";

// --- Path traversal guard ---

/**
 * Resolves a tracked file path against the repo root.
 * Returns null if the resolved path escapes the repo root (path traversal guard).
 */
export function resolveTrackedFilePath(inputPath: string, repoRoot: string): string | null {
  const resolved = isAbsolute(inputPath) ? resolve(inputPath) : resolve(repoRoot, inputPath);
  // Normalize root to ensure trailing slash for prefix matching
  const normalizedRoot = repoRoot.endsWith("/") ? repoRoot : repoRoot + "/";
  if (!resolved.startsWith(normalizedRoot) && resolved !== repoRoot) {
    return null; // path traversal rejected — caller treats as missing
  }
  return resolved;
}

// --- mtime-first, hash-fallback comparison ---

export async function compareTrackedFile(file: TrackedFile, repoRoot: string): Promise<FileComparisonResult> {
  const absolutePath = resolveTrackedFilePath(file.path, repoRoot);

  if (absolutePath === null) {
    // Path traversal attempt — treat as missing, never follow
    return { path: file.path, status: "missing", reason: "missing" };
  }

  try {
    const fileStat = await lstat(absolutePath);   // lstat: reads symlink node, not target
    const currentMtime = fileStat.mtimeMs;

    if (currentMtime === file.mtime) {
      return { path: file.path, status: "unchanged" };  // fast path: no expensive hash
    }

    // mtime differs — check hash only if one was stored (avoids false positives from touch)
    if (file.hash) {
      const currentHash = await computeFileHash(absolutePath);
      if (currentHash === file.hash) {
        return { path: file.path, status: "unchanged" };  // touched but not modified
      }
      return { path: file.path, status: "changed", reason: "hash" };
    }

    // No hash stored — mtime change alone is sufficient signal
    return { path: file.path, status: "changed", reason: "mtime" };
  } catch (err) {
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      return { path: file.path, status: "missing", reason: "missing" };
    }
    throw err;  // re-throw unexpected errors — do not silently swallow
  }
}

// --- Promise.all for concurrent stat + hash on multiple files ---

/**
 * Resolves mtime and hash for a list of path-only entries concurrently.
 * Never throws — falls back to { path, mtime: 0 } on error or traversal rejection.
 */
export async function resolveTrackedFileStats(
  files: Array<{ path: string }>,
  repoRoot: string,
): Promise<TrackedFile[]> {
  return Promise.all(
    files.map(async (file) => {
      const absolutePath = resolveTrackedFilePath(file.path, repoRoot);
      if (absolutePath === null) {
        return { path: file.path, mtime: 0 };  // traversal rejected — use sentinel mtime
      }
      try {
        // lstat + SHA-256 in parallel — avoids sequential awaits
        const [fileStat, hash] = await Promise.all([
          lstat(absolutePath),
          computeFileHash(absolutePath),
        ]);
        return { path: file.path, mtime: fileStat.mtimeMs, hash };
      } catch {
        // Always return gracefully — "never throws" contract
        return { path: file.path, mtime: 0 };
      }
    }),
  );
}

export async function computeFileHash(filePath: string): Promise<string> {
  const content = await readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
}
```

## Key rules

- Always pass user-supplied paths through `resolveTrackedFilePath()` before any fs operation
- `null` return from the guard means "rejected" — treat as missing, never dereference
- Use `lstat` not `stat` — reads the symlink inode itself, not its target
- Use `Promise.all([lstat, hash])` for concurrent operations on a single file
- Use `files.map(async ...) + Promise.all(...)` for concurrent operations across many files
- The "never throws" contract on `resolveTrackedFileStats` is intentional — callers detect failure via `mtime === 0`
