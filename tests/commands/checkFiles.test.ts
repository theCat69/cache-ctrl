import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, stat, utimes, rm } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { checkFilesCommand } from "../../src/commands/checkFiles.js";
import { ErrorCode } from "../../src/types/result.js";

const LOCAL_DIR = join(".ai", "local-context-gatherer_cache");

let origCwd: string;
let tmpDir: string;

beforeEach(async () => {
  origCwd = process.cwd();
  tmpDir = await mkdtemp(join(tmpdir(), "cache-ctrl-checkfiles-"));
  process.chdir(tmpDir);
  await mkdir(join(tmpDir, LOCAL_DIR), { recursive: true });
});

afterEach(() => {
  process.chdir(origCwd);
});

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function getMtime(filePath: string): Promise<number> {
  return (await stat(filePath)).mtimeMs;
}

async function writeLocalCache(trackedFiles: Array<{ path: string; mtime: number; hash?: string }>): Promise<void> {
  const localPath = join(tmpDir, LOCAL_DIR, "context.json");
  await writeFile(
    localPath,
    JSON.stringify({
      timestamp: new Date().toISOString(),
      topic: "test scan",
      description: "Test local cache",
      tracked_files: trackedFiles,
    }),
  );
}

describe("checkFilesCommand", () => {
  it("returns FILE_NOT_FOUND when local cache does not exist", async () => {
    const result = await checkFilesCommand();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("FILE_NOT_FOUND");
  });

  it("returns PARSE_ERROR when local cache JSON is malformed", async () => {
    const localPath = join(tmpDir, LOCAL_DIR, "context.json");
    await writeFile(localPath, "{ this is not valid json }");

    const result = await checkFilesCommand();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ErrorCode.PARSE_ERROR);
    expect(result.error).toContain("Failed to parse JSON");
  });

  it("returns unchanged for empty tracked_files list", async () => {
    await writeLocalCache([]);
    const result = await checkFilesCommand();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("unchanged");
    expect(result.value.changed_files).toHaveLength(0);
    expect(result.value.unchanged_files).toHaveLength(0);
    expect(result.value.missing_files).toHaveLength(0);
    expect(result.value.new_files).toEqual([]);
    expect(result.value.deleted_git_files).toEqual([]);
  });

  it("returns unchanged when mtime matches", async () => {
    const trackedPath = join(tmpDir, "tracked.ts");
    await writeFile(trackedPath, "export const x = 1;");
    const mtime = await getMtime(trackedPath);

    await writeLocalCache([{ path: "tracked.ts", mtime }]);
    const result = await checkFilesCommand();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("unchanged");
    expect(result.value.unchanged_files).toContain("tracked.ts");
    expect(result.value.new_files).toEqual([]);
    expect(result.value.deleted_git_files).toEqual([]);
  });

  it("returns changed when mtime differs and no hash stored", async () => {
    const trackedPath = join(tmpDir, "tracked.ts");
    await writeFile(trackedPath, "export const x = 1;");

    // Store a fake mtime that doesn't match the real one
    await writeLocalCache([{ path: "tracked.ts", mtime: 999_999_999 }]);
    const result = await checkFilesCommand();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("changed");
    expect(result.value.changed_files[0]!.path).toBe("tracked.ts");
    expect(result.value.changed_files[0]!.reason).toBe("mtime");
    expect(result.value.new_files).toEqual([]);
    expect(result.value.deleted_git_files).toEqual([]);
  });

  it("returns unchanged when mtime differs but hash matches (touch-only change)", async () => {
    const trackedPath = join(tmpDir, "tracked.ts");
    const content = "export const x = 1;";
    await writeFile(trackedPath, content);
    const realMtime = await getMtime(trackedPath);
    const hash = sha256(content);

    // Store a slightly different mtime but correct hash
    const fakeMtime = realMtime - 5000;
    await writeLocalCache([{ path: "tracked.ts", mtime: fakeMtime, hash }]);

    const result = await checkFilesCommand();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("unchanged");
    expect(result.value.unchanged_files).toContain("tracked.ts");
    expect(result.value.new_files).toEqual([]);
    expect(result.value.deleted_git_files).toEqual([]);
  });

  it("returns changed with reason=hash when mtime and hash both differ", async () => {
    const trackedPath = join(tmpDir, "tracked.ts");
    await writeFile(trackedPath, "export const x = 2;"); // new content

    // Store old mtime and old hash
    await writeLocalCache([{ path: "tracked.ts", mtime: 999_999_999, hash: sha256("export const x = 1;") }]);
    const result = await checkFilesCommand();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("changed");
    expect(result.value.changed_files[0]!.reason).toBe("hash");
    expect(result.value.new_files).toEqual([]);
    expect(result.value.deleted_git_files).toEqual([]);
  });

  it("reports missing files in both missing_files and changed_files", async () => {
    await writeLocalCache([{ path: "does-not-exist.ts", mtime: 1_000_000 }]);
    const result = await checkFilesCommand();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("changed");
    expect(result.value.missing_files).toContain("does-not-exist.ts");
    expect(result.value.changed_files[0]!.reason).toBe("missing");
    expect(result.value.new_files).toEqual([]);
    expect(result.value.deleted_git_files).toEqual([]);
  });

  it("rejects path traversal attempts — treated as missing", async () => {
    await writeLocalCache([{ path: "../../etc/passwd", mtime: 1_000_000 }]);
    const result = await checkFilesCommand();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Path traversal → missing
    expect(result.value.missing_files).toContain("../../etc/passwd");
    expect(result.value.new_files).toEqual([]);
    expect(result.value.deleted_git_files).toEqual([]);
  });

  it("handles a mix of changed, unchanged, and missing files", async () => {
    const unchangedPath = join(tmpDir, "unchanged.ts");
    const changedPath = join(tmpDir, "changed.ts");
    await writeFile(unchangedPath, "const a = 1;");
    await writeFile(changedPath, "const b = 2;");

    const unchangedMtime = await getMtime(unchangedPath);

    await writeLocalCache([
      { path: "unchanged.ts", mtime: unchangedMtime },
      { path: "changed.ts", mtime: 1 }, // wrong mtime
      { path: "missing.ts", mtime: 1_000_000 },
    ]);

    const result = await checkFilesCommand();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("changed");
    expect(result.value.unchanged_files).toContain("unchanged.ts");
    expect(result.value.changed_files.map((f) => f.path)).toContain("changed.ts");
    expect(result.value.missing_files).toContain("missing.ts");
    expect(result.value.new_files).toEqual([]);
    expect(result.value.deleted_git_files).toEqual([]);
  });
});

function initGitRepo(dir: string): void {
  execFileSync("git", ["init"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  writeFileSync(join(dir, ".gitignore"), ".ai/\n");
  execFileSync("git", ["add", ".gitignore"], { cwd: dir });
  execFileSync("git", ["commit", "-m", "chore: init gitignore"], { cwd: dir });
}

describe("git file detection", () => {
  it("non-git dir → new_files and deleted_git_files are []", async () => {
    const trackedPath = join(tmpDir, "tracked.ts");
    await writeFile(trackedPath, "export const x = 1;");
    const mtime = await getMtime(trackedPath);

    await writeLocalCache([{ path: "tracked.ts", mtime }]);
    const result = await checkFilesCommand();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.new_files).toEqual([]);
    expect(result.value.deleted_git_files).toEqual([]);
  });

  it("committed file not in tracked_files → appears in new_files only when tracked_files is non-empty", async () => {
    initGitRepo(tmpDir);
    const filePath = join(tmpDir, "file.ts");
    await writeFile(filePath, "export const x = 1;");
    execFileSync("git", ["add", "."], { cwd: tmpDir });
    execFileSync("git", ["commit", "-m", "init"], { cwd: tmpDir });

    // Cache has one tracked file — file.ts is known to git but not cached → new_files
    const otherPath = join(tmpDir, "other.ts");
    await writeFile(otherPath, "export const y = 2;");
    const mtime = await getMtime(otherPath);
    execFileSync("git", ["add", "."], { cwd: tmpDir });
    execFileSync("git", ["commit", "-m", "add other"], { cwd: tmpDir });

    await writeLocalCache([{ path: "other.ts", mtime }]);
    const result = await checkFilesCommand();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.new_files).toContain("file.ts");
    expect(result.value.status).toBe("changed");
  });

  it("empty tracked_files → status unchanged even when git files exist", async () => {
    initGitRepo(tmpDir);
    const filePath = join(tmpDir, "file.ts");
    await writeFile(filePath, "export const x = 1;");
    execFileSync("git", ["add", "."], { cwd: tmpDir });
    execFileSync("git", ["commit", "-m", "init"], { cwd: tmpDir });

    // Cache has empty tracked_files — blank-slate, nothing to compare
    await writeLocalCache([]);
    const result = await checkFilesCommand();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.new_files).toEqual([]);
    expect(result.value.status).toBe("unchanged");
  });

  it("untracked-non-ignored file with non-empty tracked_files → appears in new_files", async () => {
    initGitRepo(tmpDir);
    // Commit an initial file so tracked_files is non-empty
    const committedPath = join(tmpDir, "committed.ts");
    await writeFile(committedPath, "export const x = 1;");
    execFileSync("git", ["add", "."], { cwd: tmpDir });
    execFileSync("git", ["commit", "-m", "init"], { cwd: tmpDir });
    const committedMtime = await getMtime(committedPath);

    // Create an untracked (not gitignored) file
    const filePath = join(tmpDir, "untracked.ts");
    await writeFile(filePath, "export const y = 2;");
    // Deliberately do NOT git add — file is untracked but not gitignored

    await writeLocalCache([{ path: "committed.ts", mtime: committedMtime }]);
    const result = await checkFilesCommand();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.new_files).toContain("untracked.ts");
    expect(result.value.status).toBe("changed");
  });

  it("committed+deleted file → appears in deleted_git_files", async () => {
    initGitRepo(tmpDir);
    const filePath = join(tmpDir, "file.ts");
    await writeFile(filePath, "export const x = 1;");
    execFileSync("git", ["add", "."], { cwd: tmpDir });
    execFileSync("git", ["commit", "-m", "init"], { cwd: tmpDir });

    // Delete from working tree only (not via git rm)
    await rm(filePath);

    const mtime = 1_000_000; // arbitrary — file is gone, mtime won't be checked
    await writeLocalCache([{ path: "file.ts", mtime }]);
    const result = await checkFilesCommand();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.deleted_git_files).toContain("file.ts");
    expect(result.value.missing_files).toContain("file.ts");
    expect(result.value.status).toBe("changed");
  });
});
