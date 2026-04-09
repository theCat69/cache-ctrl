import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compareTrackedFile, computeFileHash, resolveTrackedFileStats, filterExistingFiles } from "../../src/files/changeDetector.js";

let origCwd: string;
let tmpDir: string;

beforeEach(async () => {
  origCwd = process.cwd();
  tmpDir = await mkdtemp(join(tmpdir(), "cache-ctrl-detector-"));
  process.chdir(tmpDir);
});

afterEach(() => {
  process.chdir(origCwd);
});

describe("changeDetector", () => {
  it("unchanged mtime → unchanged", async () => {
    const filePath = join(tmpDir, "stable.ts");
    await writeFile(filePath, "export const x = 1;");

    const { stat } = await import("node:fs/promises");
    const fileStat = await stat(filePath);

    const result = await compareTrackedFile(
      { path: filePath, mtime: fileStat.mtimeMs },
      tmpDir,
    );
    expect(result.status).toBe("unchanged");
  });

  it("changed mtime, no hash stored → changed with reason mtime", async () => {
    const filePath = join(tmpDir, "changed.ts");
    await writeFile(filePath, "export const x = 1;");

    const oldMtime = 1000000; // Far in the past

    const result = await compareTrackedFile(
      { path: filePath, mtime: oldMtime },
      tmpDir,
    );
    expect(result.status).toBe("changed");
    expect(result.reason).toBe("mtime");
  });

  it("changed mtime, hash stored and matches → unchanged (hash is authoritative)", async () => {
    const filePath = join(tmpDir, "touch-only.ts");
    const content = "export const x = 1;";
    await writeFile(filePath, content);

    const hash = await computeFileHash(filePath);
    const oldMtime = 1000000; // Different mtime

    const result = await compareTrackedFile(
      { path: filePath, mtime: oldMtime, hash },
      tmpDir,
    );
    expect(result.status).toBe("unchanged");
  });

  it("changed mtime, hash stored and differs → changed with reason hash", async () => {
    const filePath = join(tmpDir, "modified.ts");
    await writeFile(filePath, "export const x = 1;");

    const oldHash = "0000000000000000000000000000000000000000000000000000000000000000"; // Wrong hash
    const oldMtime = 1000000;

    const result = await compareTrackedFile(
      { path: filePath, mtime: oldMtime, hash: oldHash },
      tmpDir,
    );
    expect(result.status).toBe("changed");
    expect(result.reason).toBe("hash");
  });

  it("missing file → missing with reason missing", async () => {
    const result = await compareTrackedFile(
      { path: join(tmpDir, "does-not-exist.ts"), mtime: 12345 },
      tmpDir,
    );
    expect(result.status).toBe("missing");
    expect(result.reason).toBe("missing");
  });

  it("relative paths are resolved against repoRoot", async () => {
    const fileName = "relative-file.ts";
    const filePath = join(tmpDir, fileName);
    await writeFile(filePath, "export const y = 2;");

    const { stat } = await import("node:fs/promises");
    const fileStat = await stat(filePath);

    const result = await compareTrackedFile(
      { path: fileName, mtime: fileStat.mtimeMs },
      tmpDir,
    );
    expect(result.status).toBe("unchanged");
  });

  it("computeFileHash produces consistent SHA-256 hex", async () => {
    const filePath = join(tmpDir, "hashable.ts");
    await writeFile(filePath, "constant content");

    const hash1 = await computeFileHash(filePath);
    const hash2 = await computeFileHash(filePath);
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("resolveTrackedFileStats", () => {
  it("injects real mtime for existing file", async () => {
    const filePath = join(tmpDir, "tracked.ts");
    await writeFile(filePath, "export const y = 2;");

    const { stat } = await import("node:fs/promises");
    const realStat = await stat(filePath);
    const realMtime = realStat.mtimeMs;

    const result = await resolveTrackedFileStats(
      [{ path: filePath }],
      tmpDir,
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.mtime).toBe(realMtime);
    expect(result[0]?.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("uses mtime=0 and no hash for missing file", async () => {
    const result = await resolveTrackedFileStats(
      [{ path: "missing/file.ts" }],
      tmpDir,
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.mtime).toBe(0);
    expect(result[0]?.hash).toBeUndefined();
  });

  it("falls back to 0 for path traversal attempt", async () => {
    const result = await resolveTrackedFileStats(
      [{ path: "../../etc/passwd" }],
      tmpDir,
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.mtime).toBe(0);
    expect(result[0]?.hash).toBeUndefined();
  });
});

describe("filterExistingFiles", () => {
  it("returns empty array for empty input", async () => {
    const result = await filterExistingFiles([], tmpDir);
    expect(result).toHaveLength(0);
  });

  it("returns all files when all exist on disk", async () => {
    const fileA = join(tmpDir, "filterA.ts");
    const fileB = join(tmpDir, "filterB.ts");
    await writeFile(fileA, "export const a = 1;");
    await writeFile(fileB, "export const b = 2;");

    const input = [
      { path: fileA, mtime: 1234, hash: "aabbcc" },
      { path: fileB, mtime: 5678, hash: "ddeeff" },
    ];

    const result = await filterExistingFiles(input, tmpDir);
    expect(result).toHaveLength(2);
  });

  it("evicts entries where file was deleted (ENOENT)", async () => {
    const existingFile = join(tmpDir, "filterExisting.ts");
    const deletedFile = join(tmpDir, "filterDeleted.ts");
    await writeFile(existingFile, "export const x = 1;");
    await writeFile(deletedFile, "export const y = 2;");
    await rm(deletedFile);

    const input = [
      { path: existingFile, mtime: 100, hash: "abc" },
      { path: deletedFile, mtime: 200, hash: "def" },
    ];

    const result = await filterExistingFiles(input, tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0]?.path).toBe(existingFile);
  });

  it("evicts entries with path traversal (resolves to null)", async () => {
    const existingFile = join(tmpDir, "filterSafe.ts");
    await writeFile(existingFile, "export const z = 1;");

    const input = [
      { path: existingFile, mtime: 100, hash: "abc" },
      { path: "../../etc/passwd", mtime: 200, hash: "bad" },
    ];

    const result = await filterExistingFiles(input, tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0]?.path).toBe(existingFile);
  });

  it("preserves mtime and hash values of kept entries unchanged", async () => {
    const filePath = join(tmpDir, "filterUnchanged.ts");
    await writeFile(filePath, "export const v = 1;");

    const input = [{ path: filePath, mtime: 99999, hash: "original-hash" }];

    const result = await filterExistingFiles(input, tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0]?.mtime).toBe(99999);
    expect(result[0]?.hash).toBe("original-hash");
  });

  it("does not recompute mtime/hash — kept entry values match input TrackedFile values", async () => {
    const filePath = join(tmpDir, "filterNoRecompute.ts");
    await writeFile(filePath, "export const w = 42;");

    const { stat } = await import("node:fs/promises");
    const realStat = await stat(filePath);
    const realMtime = realStat.mtimeMs;

    // Provide deliberately wrong mtime and hash — function must NOT recompute
    const inputMtime = realMtime + 9999;
    const inputHash = "deliberately-wrong-hash";
    const input = [{ path: filePath, mtime: inputMtime, hash: inputHash }];

    const result = await filterExistingFiles(input, tmpDir);
    expect(result).toHaveLength(1);
    // Must match input values, not the real file stats
    expect(result[0]?.mtime).toBe(inputMtime);
    expect(result[0]?.hash).toBe(inputHash);
  });
});
