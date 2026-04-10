import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCache, writeCache, listCacheFiles, acquireLock, releaseLock } from "../../src/cache/cacheManager.js";

let origCwd: string;
let tmpDir: string;

beforeEach(async () => {
  origCwd = process.cwd();
  tmpDir = await mkdtemp(join(tmpdir(), "cache-ctrl-manager-"));
  process.chdir(tmpDir);
});

afterEach(async () => {
  process.chdir(origCwd);
});

describe("cacheManager", () => {
  describe("readCache", () => {
    it("returns parsed object for valid file", async () => {
      const filePath = join(tmpDir, "test.json");
      await writeFile(filePath, JSON.stringify({ key: "value", nested: { a: 1 } }));

      const result = await readCache(filePath);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.key).toBe("value");
    });

    it("returns PARSE_ERROR for malformed JSON", async () => {
      const filePath = join(tmpDir, "bad.json");
      await writeFile(filePath, "{ not valid json }");

      const result = await readCache(filePath);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe("PARSE_ERROR");
    });

    it("returns FILE_NOT_FOUND for missing file", async () => {
      const result = await readCache(join(tmpDir, "nonexistent.json"));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe("FILE_NOT_FOUND");
    });
  });

  describe("writeCache", () => {
    it("creates file if not existing", async () => {
      const filePath = join(tmpDir, "new.json");
      const result = await writeCache(filePath, { subject: "new", fetched_at: "2026-01-01T00:00:00Z" } as Record<string, unknown>);
      expect(result.ok).toBe(true);

      const content = JSON.parse(await readFile(filePath, "utf-8")) as Record<string, unknown>;
      expect(content.subject).toBe("new");
    });

    it("merges updates with existing content (preserves unknown fields)", async () => {
      const filePath = join(tmpDir, "existing.json");
      await writeFile(
        filePath,
        JSON.stringify({
          subject: "existing",
          custom_field: "preserved",
          fetched_at: "2026-01-01T00:00:00Z",
        }),
      );

      const result = await writeCache(filePath, { fetched_at: "2026-06-01T00:00:00Z" } as Record<string, unknown>);
      expect(result.ok).toBe(true);

      const content = JSON.parse(await readFile(filePath, "utf-8")) as Record<string, unknown>;
      expect(content.subject).toBe("existing");
      expect(content.custom_field).toBe("preserved");
      expect(content.fetched_at).toBe("2026-06-01T00:00:00Z");
    });

    it("acquires and releases lock", async () => {
      const filePath = join(tmpDir, "locktest.json");
      const lockPath = `${filePath}.lock`;

      const writePromise = writeCache(filePath, { fetched_at: "2026-01-01T00:00:00Z" } as Record<string, unknown>);

      // After write completes, lock should be released
      await writePromise;

      // Lock file should not exist after write
      try {
        await readFile(lockPath, "utf-8");
        throw new Error("Lock file should have been removed");
      } catch (err) {
        const error = err as NodeJS.ErrnoException;
        expect(error.code).toBe("ENOENT");
      }
    });

    it("replaces all existing content when mode is 'replace'", async () => {
      const filePath = join(tmpDir, "replace-test.json");

      // Write initial content with some keys
      await writeCache(filePath, { subject: "original", extra_field: "keep-me", fetched_at: "2026-01-01T00:00:00Z" } as Record<string, unknown>);

      // Write again with mode:'replace' — only the new keys should survive
      const result = await writeCache(filePath, { subject: "replaced" } as Record<string, unknown>, "replace");
      expect(result.ok).toBe(true);

      const content = JSON.parse(await readFile(filePath, "utf-8")) as Record<string, unknown>;
      expect(content.subject).toBe("replaced");
      // Old keys must be gone — not merged in
      expect(content.extra_field).toBeUndefined();
      expect(content.fetched_at).toBeUndefined();
    });

    it("performs read/write round-trip correctly", async () => {
      const filePath = join(tmpDir, "roundtrip.json");
      const data = { subject: "test", value: 42, nested: { a: [1, 2, 3] } };
      await writeCache(filePath, data as unknown as Record<string, unknown>);

      const result = await readCache(filePath);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.subject).toBe("test");
      expect(result.value.value).toBe(42);
    });
  });

  describe("listCacheFiles", () => {
    it("lists .json files and excludes .lock files", async () => {
      const cacheDir = join(tmpDir, ".ai", "external-context-gatherer_cache");
      await mkdir(cacheDir, { recursive: true });
      await writeFile(join(cacheDir, "alpha.json"), "{}");
      await writeFile(join(cacheDir, "beta.json"), "{}");
      await writeFile(join(cacheDir, "alpha.json.lock"), "12345\n");

      const result = await listCacheFiles("external", tmpDir);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(2);
      expect(result.value.some((f) => f.endsWith(".lock"))).toBe(false);
    });

    it("returns empty array for non-existent directory", async () => {
      const result = await listCacheFiles("external", tmpDir);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(0);
    });
  });

  describe("acquireLock / releaseLock", () => {
    it("acquires and releases lock successfully", async () => {
      const filePath = join(tmpDir, "lockable.json");
      const lockPath = `${filePath}.lock`;

      const result = await acquireLock(filePath);
      expect(result.ok).toBe(true);

      const content = await readFile(lockPath, "utf-8");
      expect(content.trim()).toBe(`${process.pid}`);

      await releaseLock(filePath);

      try {
        await readFile(lockPath, "utf-8");
        throw new Error("Lock should be gone");
      } catch (err) {
        const error = err as NodeJS.ErrnoException;
        expect(error.code).toBe("ENOENT");
      }
    });
  });
});
