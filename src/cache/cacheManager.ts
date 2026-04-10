import { readFile, writeFile, rename, stat, unlink, readdir, mkdir } from "node:fs/promises";
import { open } from "node:fs/promises";
import { join, dirname } from "node:path";
import { randomBytes } from "node:crypto";
import type { AgentType, CacheEntry, ExternalCacheFile, LocalCacheFile } from "../types/cache.js";
import { ExternalCacheFileSchema } from "../types/cache.js";
import { ErrorCode, type Result } from "../types/result.js";
import { getFileStem } from "../utils/fileStem.js";

const LOCK_RETRY_INTERVAL_MS = 50;
const LOCK_TIMEOUT_MS = 5000;
const LOCK_STALE_AGE_MS = 30_000;

export async function findRepoRoot(startDir: string): Promise<string> {
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

export function resolveCacheDir(agent: AgentType, repoRoot: string): string {
  if (agent === "external") {
    return join(repoRoot, ".ai", "external-context-gatherer_cache");
  }
  return join(repoRoot, ".ai", "local-context-gatherer_cache");
}

export async function readCache(filePath: string): Promise<Result<Record<string, unknown>>> {
  try {
    const content = await readFile(filePath, "utf-8");
    try {
      const parsed = JSON.parse(content) as Record<string, unknown>;
      return { ok: true, value: parsed };
    } catch {
      return { ok: false, error: `Failed to parse JSON: ${filePath}`, code: ErrorCode.PARSE_ERROR };
    }
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === "ENOENT") {
      return { ok: false, error: `Cache file not found: ${filePath}`, code: ErrorCode.FILE_NOT_FOUND };
    }
    return { ok: false, error: `Failed to read file: ${filePath}: ${error.message}`, code: ErrorCode.FILE_READ_ERROR };
  }
}

export async function writeCache(
  filePath: string,
  updates: Partial<ExternalCacheFile> | Partial<LocalCacheFile> | Record<string, unknown>,
  mode: "merge" | "replace" = "merge",
): Promise<Result<void>> {
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

export async function listCacheFiles(agent: AgentType, repoRoot: string): Promise<Result<string[]>> {
  const cacheDir = resolveCacheDir(agent, repoRoot);
  try {
    const entries = await readdir(cacheDir);
    const jsonFiles = entries
      .filter((name) => name.endsWith(".json") && !name.endsWith(".lock"))
      .map((name) => join(cacheDir, name));
    return { ok: true, value: jsonFiles };
  } catch (err) {
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
      fetched_at: data.fetched_at ?? "",
    });
  }

  return { ok: true, value: entries };
}

export async function acquireLock(filePath: string): Promise<Result<void>> {
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

export async function releaseLock(filePath: string): Promise<void> {
  const lockPath = `${filePath}.lock`;
  try {
    await unlink(lockPath);
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code !== "ENOENT") {
      console.warn(`[cache-ctrl] Warning: failed to release lock ${lockPath}: ${error.message}`);
    }
  }
}

async function isLockStale(lockPath: string): Promise<boolean> {
  try {
    const lockStat = await stat(lockPath);
    const ageMs = Date.now() - lockStat.mtimeMs;
    if (ageMs > LOCK_STALE_AGE_MS) {
      return true;
    }

    const content = await readFile(lockPath, "utf-8");
    const pidStr = content.trim();
    const pid = parseInt(pidStr, 10);
    if (isNaN(pid) || pid <= 0 || pid >= 4_194_304) {
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
