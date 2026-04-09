import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeCache, acquireLock, releaseLock } from "../../src/cache/cacheManager.js";

let origCwd: string;
let tmpDir: string;

beforeEach(async () => {
  origCwd = process.cwd();
  tmpDir = await mkdtemp(join(tmpdir(), "cache-ctrl-concurrency-"));
  process.chdir(tmpDir);
});

afterEach(() => {
  process.chdir(origCwd);
});

describe("concurrency", () => {
  it("two parallel writeCache calls do not corrupt output", async () => {
    const filePath = join(tmpDir, "shared.json");
    await writeFile(filePath, JSON.stringify({ version: 0, field_a: "original_a", field_b: "original_b" }));

    const write1 = writeCache(filePath, { field_a: "updated_by_1" } as Record<string, unknown>);
    const write2 = writeCache(filePath, { field_b: "updated_by_2" } as Record<string, unknown>);

    const [r1, r2] = await Promise.all([write1, write2]);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);

    const content = JSON.parse(await readFile(filePath, "utf-8")) as Record<string, unknown>;
    // Both writes used spread-merge: each writer reads current content then merges its update.
    // One writer won the lock first, the other acquired it second and re-read the already-updated file.
    // The final state must have both field_a and field_b written, and the original version preserved.
    expect(content["field_a"]).toBe("updated_by_1");
    expect(content["field_b"]).toBe("updated_by_2");
    // version should still be present
    expect(content.version).toBe(0);
  });

  it("second writer waits for first writer to release lock", async () => {
    const filePath = join(tmpDir, "sequential.json");
    await writeFile(filePath, JSON.stringify({ step: 0 }));

    // Acquire the lock manually to simulate a held lock
    const lockResult = await acquireLock(filePath);
    expect(lockResult.ok).toBe(true);

    // Second writer should eventually succeed after we release
    const writePromise = writeCache(filePath, { step: 1 } as Record<string, unknown>);

    // Release lock after a short delay
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    await releaseLock(filePath);

    const result = await writePromise;
    expect(result.ok).toBe(true);

    const content = JSON.parse(await readFile(filePath, "utf-8")) as Record<string, unknown>;
    expect(content.step).toBe(1);
  });

  it("stale lock (mtime > 30s) is ignored and overridden", async () => {
    const filePath = join(tmpDir, "stale-test.json");
    const lockPath = `${filePath}.lock`;

    // Create a lock with a non-existent PID (99999999 is very unlikely to exist)
    await writeFile(lockPath, "99999999\n");

    // Backdate the lock file to simulate an old lock
    const past = new Date(Date.now() - 60_000);
    const { utimes } = await import("node:fs/promises");
    await utimes(lockPath, past, past);

    const result = await writeCache(filePath, { recovered: true } as Record<string, unknown>);
    expect(result.ok).toBe(true);

    const content = JSON.parse(await readFile(filePath, "utf-8")) as Record<string, unknown>;
    expect(content.recovered).toBe(true);
  });

  it("returns LOCK_TIMEOUT after 5s if lock is never released", async () => {
    const filePath = join(tmpDir, "stuck.json");
    const lockPath = `${filePath}.lock`;

    // Create a lock with the current process PID so it appears alive
    await writeFile(lockPath, `${process.pid}\n`);

    const start = Date.now();
    const result = await writeCache(filePath, { data: "test" } as Record<string, unknown>);
    const elapsed = Date.now() - start;

    // Should have timed out
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("LOCK_TIMEOUT");
    // Should have waited ~5 seconds (allow some slack)
    expect(elapsed).toBeGreaterThanOrEqual(4_500);

    // Clean up the lock file
    await releaseLock(filePath);
  }, 10_000);
});
