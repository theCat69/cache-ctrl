import { join, dirname } from "node:path";
import { randomBytes } from "node:crypto";
import type { AgentType, CacheEntry, ExternalCacheFile, LocalCacheFile } from "../types/cache.js";
import { ExternalCacheFileSchema } from "../types/cache.js";
import { ErrorCode, type Result } from "../types/result.js";
import { getFileStem } from "../utils/fileStem.js";

const LOCK_RETRY_INTERVAL_MS = 50;
const LOCK_TIMEOUT_MS = 5000;
const LOCK_STALE_AGE_MS = 30_000;

/**
 * Resolves the repository root by walking upward until a `.git` directory is found.
 *
 * @param startDir - Directory where upward detection starts.
 * @returns Absolute path to detected repo root, or `startDir` when no `.git` is found.
 * @remarks Uses a parent-directory walk; on filesystem root fallback it intentionally
 * returns `startDir` so CLI behavior remains deterministic outside git repositories.
 */
export async function findRepoRoot(startDir: string): Promise<string> {
  const { stat } = await import("node:fs/promises");
  let current = startDir;
  while (true) {
    try {
      await stat(join(current, ".git"));
      return current;
    } catch {
      const parent = dirname(current);
      if (parent === current) {
        // Reached filesystem root — fall back to startDir
        return startDir;
      }
      current = parent;
    }
  }
}

/** Resolves the on-disk cache directory for a given agent namespace. */
export function resolveCacheDir(agent: AgentType, repoRoot: string): string {
  if (agent === "external") {
    return join(repoRoot, ".ai", "external-context-gatherer_cache");
  }
  return join(repoRoot, ".ai", "local-context-gatherer_cache");
}

/**
 * Reads and JSON-parses one cache file.
 *
 * @param filePath - Absolute cache file path.
 * @returns Parsed object on success, or typed read/parse failures.
 * @remarks Returns `FILE_NOT_FOUND` when the file is absent, and `PARSE_ERROR` when the
 * file exists but contains invalid JSON. Low-level I/O failures return `FILE_READ_ERROR`.
 */
export async function readCache(filePath: string): Promise<Result<Record<string, unknown>>> {
  const { readFile } = await import("node:fs/promises");
  try {
    const content = await readFile(filePath, "utf-8");
    try {
      const parsed = JSON.parse(content) as Record<string, unknown>;
      return { ok: true, value: parsed };
    } catch {
      return { ok: false, error: `Failed to parse JSON: ${filePath}`, code: ErrorCode.PARSE_ERROR };
    }
  } catch (err) {
    // intentional: err is ErrnoException at this catch site — structuredError is set only on filesystem failures
    const error = err as NodeJS.ErrnoException;
    if (error.code === "ENOENT") {
      return { ok: false, error: `Cache file not found: ${filePath}`, code: ErrorCode.FILE_NOT_FOUND };
    }
    return { ok: false, error: `Failed to read file: ${filePath}: ${error.message}`, code: ErrorCode.FILE_READ_ERROR };
  }
}

/**
 * Writes cache content using advisory locking and atomic rename.
 *
 * @param filePath - Absolute cache file path to write.
 * @param updates - Partial updates (`merge`) or full replacement payload (`replace`).
 * @param mode - `merge` overlays updates onto existing JSON; `replace` writes payload as-is.
 * @remarks In `merge` mode the function performs read-modify-write preserving unknown fields.
 * Writes use temp-file + `rename()` for atomic visibility. A per-file advisory lock is
 * acquired before mutation and released in `finally`, preventing concurrent writers from
 * interleaving updates.
 */
export async function writeCache(
  filePath: string,
  updates: Partial<ExternalCacheFile> | Partial<LocalCacheFile> | Record<string, unknown>,
  mode: "merge" | "replace" = "merge",
): Promise<Result<void>> {
  const { mkdir, rename, unlink, writeFile } = await import("node:fs/promises");
  // Ensure parent directory exists before acquiring the lock
  await mkdir(dirname(filePath), { recursive: true });

  const lockResult = await acquireLock(filePath);
  if (!lockResult.ok) return lockResult;

  try {
    let merged: Record<string, unknown>;

    if (mode === "replace") {
      merged = updates as Record<string, unknown>;
    } else {
      // Read existing content if file exists
      let existing: Record<string, unknown> = {};
      const readResult = await readCache(filePath);
      if (readResult.ok) {
        existing = readResult.value;
      } else if (readResult.code !== ErrorCode.FILE_NOT_FOUND) {
        return { ok: false, error: readResult.error, code: readResult.code };
      }
      merged = { ...existing, ...updates };
    }
    const tmpPath = `${filePath}.tmp.${process.pid}.${randomBytes(6).toString("hex")}`;

    try {
      await writeFile(tmpPath, JSON.stringify(merged, null, 2), "utf-8");
      await rename(tmpPath, filePath);
      return { ok: true, value: undefined };
    } catch (err) {
      // intentional: err is ErrnoException at this catch site — structuredError is set only on filesystem failures
      const error = err as NodeJS.ErrnoException;
      // Clean up tmp file on failure
      try {
        await unlink(tmpPath);
      } catch {
        // Ignore cleanup failure
      }
      return { ok: false, error: `Failed to write cache: ${error.message}`, code: ErrorCode.FILE_WRITE_ERROR };
    }
  } finally {
    await releaseLock(filePath);
  }
}

/**
 * Lists JSON cache files for an agent namespace.
 *
 * @param agent - Cache namespace to inspect.
 * @param repoRoot - Repository root used to resolve cache directory paths.
 * @returns Absolute `.json` file paths; returns an empty array when directory is absent.
 */
export async function listCacheFiles(agent: AgentType, repoRoot: string): Promise<Result<string[]>> {
  const { readdir } = await import("node:fs/promises");
  const cacheDir = resolveCacheDir(agent, repoRoot);
  try {
    const entries = await readdir(cacheDir);
    const jsonFiles = entries
      .filter((name) => name.endsWith(".json") && !name.endsWith(".lock"))
      .map((name) => join(cacheDir, name));
    return { ok: true, value: jsonFiles };
  } catch (err) {
    // intentional: err is ErrnoException at this catch site — structuredError is set only on filesystem failures
    const error = err as NodeJS.ErrnoException;
    if (error.code === "ENOENT") {
      return { ok: true, value: [] };
    }
    return { ok: false, error: `Failed to list cache directory: ${error.message}`, code: ErrorCode.FILE_READ_ERROR };
  }
}

/**
 * Loads all valid external cache entries for a repo, returning a `CacheEntry` array.
 * Files that cannot be read or fail schema validation are skipped with a warning to stderr.
 * Returns `ok: false` only when the cache directory itself cannot be listed.
 */
export async function loadExternalCacheEntries(repoRoot: string): Promise<Result<CacheEntry[]>> {
  const filesResult = await listCacheFiles("external", repoRoot);
  if (!filesResult.ok) return filesResult;

  const entries: CacheEntry[] = [];
  for (const filePath of filesResult.value) {
    const readResult = await readCache(filePath);
    if (!readResult.ok) {
      process.stderr.write(`[cache-ctrl] Warning: skipping invalid JSON file: ${filePath}\n`);
      continue;
    }
    const parseResult = ExternalCacheFileSchema.safeParse(readResult.value);
    if (!parseResult.success) {
      process.stderr.write(`[cache-ctrl] Warning: skipping malformed external cache file: ${filePath}\n`);
      continue;
    }
    const data: ExternalCacheFile = parseResult.data;
    const stem = getFileStem(filePath);
    const subject = data.subject ?? stem;
    if (subject !== stem) {
      process.stderr.write(`[cache-ctrl] Warning: subject "${subject}" does not match file stem "${stem}" in ${filePath}\n`);
    }
    entries.push({
      file: filePath,
      agent: "external",
      subject,
      description: data.description,
      fetched_at: data.fetched_at,
    });
  }

  return { ok: true, value: entries };
}

/**
 * Acquires an advisory lock file for a cache path.
 *
 * @param filePath - Cache file path whose lock (`.lock`) should be acquired.
 * @returns `ok: true` when lock is acquired, otherwise typed lock failure.
 * @remarks Uses atomic `O_EXCL` create semantics to guarantee single-writer lock acquisition.
 * Existing locks are checked for staleness via lock age and PID liveness (`process.kill(pid, 0)`).
 * Retries every 50ms and fails with `LOCK_TIMEOUT` after 5 seconds.
 */
export async function acquireLock(filePath: string): Promise<Result<void>> {
  const { open, unlink } = await import("node:fs/promises");
  const lockPath = `${filePath}.lock`;
  const start = Date.now();

  while (true) {
    try {
      // O_EXCL: atomic create, fails if exists
      const fh = await open(lockPath, "wx");
      await fh.write(`${process.pid}\n`);
      await fh.close();
      return { ok: true, value: undefined };
    } catch (err) {
        // intentional: err is ErrnoException at this catch site — structuredError is set only on filesystem failures
        const error = err as NodeJS.ErrnoException;
        if (error.code !== "EEXIST") {
          return { ok: false, error: `Lock error: ${error.message}`, code: ErrorCode.LOCK_ERROR };
        }

        // Lock exists — check if stale
        const staleResult = await isLockStale(lockPath);
        if (staleResult) {
          // Remove stale lock and retry immediately
          try {
            await unlink(lockPath);
          } catch {
            // Another process may have removed it already
          }
          continue;
        }

        // Check timeout
        if (Date.now() - start >= LOCK_TIMEOUT_MS) {
          return { ok: false, error: "Lock timeout: could not acquire lock within 5 seconds", code: ErrorCode.LOCK_TIMEOUT };
        }

        // Wait and retry
        await sleep(LOCK_RETRY_INTERVAL_MS);
    }
  }
}

/**
 * Releases a previously acquired advisory lock file.
 *
 * @param filePath - Cache file path whose `.lock` file should be removed.
 * @remarks `ENOENT` is intentionally ignored to keep release fire-and-forget safe.
 */
export async function releaseLock(filePath: string): Promise<void> {
  const { unlink } = await import("node:fs/promises");
  const lockPath = `${filePath}.lock`;
  try {
    await unlink(lockPath);
  } catch (err) {
    // intentional: err is ErrnoException at this catch site — structuredError is set only on filesystem failures
    const error = err as NodeJS.ErrnoException;
    if (error.code !== "ENOENT") {
      process.stderr.write(`[cache-ctrl] Warning: failed to release lock ${lockPath}: ${error.message}\n`);
    }
  }
}

async function isLockStale(lockPath: string): Promise<boolean> {
  const { readFile, stat } = await import("node:fs/promises");
  try {
    const lockStat = await stat(lockPath);
    const ageMs = Date.now() - lockStat.mtimeMs;
    if (ageMs > LOCK_STALE_AGE_MS) {
      return true;
    }

    const content = await readFile(lockPath, "utf-8");
    const pidStr = content.trim();
    const pid = parseInt(pidStr, 10);
    if (Number.isNaN(pid) || pid <= 0 || pid >= 4_194_304) {
      return true;
    }

    try {
      process.kill(pid, 0);
      return false; // PID is alive
    } catch {
      return true; // PID is dead
    }
  } catch {
    // Cannot read lock — treat as stale
    return true;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
