import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acquireLock,
  findRepoRoot,
  listCacheFiles,
  loadExternalCacheEntries,
  readCache,
  releaseLock,
  resolveCacheDir,
  writeCache,
} from "../../src/cache/cacheManager.js";

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
  describe("findRepoRoot", () => {
    it("returns startDir when no .git is found", async () => {
      const nestedStartDir = join(tmpDir, "a", "b", "c");
      await mkdir(nestedStartDir, { recursive: true });

      const result = await findRepoRoot(nestedStartDir);

      expect(result).toBe(nestedStartDir);
    });
  });

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
    it("resolves external cache directory under .ai", () => {
      const externalDir = resolveCacheDir("external", tmpDir);
      expect(externalDir).toBe(join(tmpDir, ".ai", "external-context-gatherer_cache"));
    });

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

  describe("loadExternalCacheEntries", () => {
    it("warns when subject does not match file stem and still loads entry", async () => {
      const cacheDir = join(tmpDir, ".ai", "external-context-gatherer_cache");
      await mkdir(cacheDir, { recursive: true });
      const filePath = join(cacheDir, "alpha.json");
      await writeFile(
        filePath,
        JSON.stringify({
          subject: "beta",
          description: "desc",
          fetched_at: "2026-04-10T00:00:00Z",
          sources: [{ type: "doc", url: "https://example.com" }],
        }),
      );

      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

      const result = await loadExternalCacheEntries(tmpDir);

      expect(result.ok).toBe(true);
      if (!result.ok) {
        stderrSpy.mockRestore();
        return;
      }

      expect(result.value).toHaveLength(1);
      expect(result.value[0]?.subject).toBe("beta");
      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining('Warning: subject "beta" does not match file stem "alpha"'),
      );

      stderrSpy.mockRestore();
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
