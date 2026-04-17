import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { getGitTrackedFiles, getGitDeletedFiles, getUntrackedNonIgnoredFiles } from "../../src/files/gitFiles.js";
import { initGitRepo } from "../../e2e/helpers/repo.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "cache-ctrl-gitfiles-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

type ExecCallback = (error: Error | null, stdout?: string, stderr?: string) => void;

async function importGitFilesWithMockedExecFile(
  mockExecFile: (file: string, args: readonly string[], options: { cwd: string; maxBuffer: number }, callback: ExecCallback) => void,
): Promise<typeof import("../../src/files/gitFiles.js")> {
  vi.resetModules();
  vi.doMock("node:child_process", () => ({
    execFile: mockExecFile,
  }));

  return import("../../src/files/gitFiles.js");
}

describe("getGitTrackedFiles", () => {
  it("returns [] for a non-git directory", async () => {
    const result = await getGitTrackedFiles(tmpDir);
    expect(result).toEqual([]);
  });

  it("returns [] for an empty git repo with no commits", async () => {
    // Bare init without any commits — use inline setup, not initGitRepo
    execFileSync("git", ["init"], { cwd: tmpDir });
    execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: tmpDir });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: tmpDir });
    const result = await getGitTrackedFiles(tmpDir);
    expect(result).toEqual([]);
  });

  it("returns committed files", async () => {
    initGitRepo(tmpDir);
    await writeFile(join(tmpDir, "file.ts"), "export const x = 1;");
    execFileSync("git", ["add", "."], { cwd: tmpDir });
    execFileSync("git", ["commit", "-m", "init"], { cwd: tmpDir });

    const result = await getGitTrackedFiles(tmpDir);
    expect(result).toContain("file.ts");
  });

  it("does NOT include untracked files (not git add'd)", async () => {
    initGitRepo(tmpDir);
    await writeFile(join(tmpDir, "untracked.ts"), "export const y = 2;");
    // Intentionally not calling git add

    const result = await getGitTrackedFiles(tmpDir);
    expect(result).not.toContain("untracked.ts");
  });
});

describe("getGitDeletedFiles", () => {
  it("returns [] for a non-git directory", async () => {
    const result = await getGitDeletedFiles(tmpDir);
    expect(result).toEqual([]);
  });

  it("returns files committed then deleted from working tree", async () => {
    initGitRepo(tmpDir);
    const filePath = join(tmpDir, "file.ts");
    await writeFile(filePath, "export const x = 1;");
    execFileSync("git", ["add", "."], { cwd: tmpDir });
    execFileSync("git", ["commit", "-m", "init"], { cwd: tmpDir });

    // Delete only from working tree (not via git rm)
    await rm(filePath);

    const result = await getGitDeletedFiles(tmpDir);
    expect(result).toContain("file.ts");
  });

  it("returns [] when no files have been deleted", async () => {
    initGitRepo(tmpDir);
    await writeFile(join(tmpDir, "file.ts"), "export const x = 1;");
    execFileSync("git", ["add", "."], { cwd: tmpDir });
    execFileSync("git", ["commit", "-m", "init"], { cwd: tmpDir });

    const result = await getGitDeletedFiles(tmpDir);
    expect(result).toEqual([]);
  });
});

describe("getUntrackedNonIgnoredFiles", () => {
  it("returns [] for a non-git directory", async () => {
    const result = await getUntrackedNonIgnoredFiles(tmpDir);
    expect(result).toEqual([]);
  });

  it("returns [] for a git repo with no untracked files", async () => {
    initGitRepo(tmpDir);
    const result = await getUntrackedNonIgnoredFiles(tmpDir);
    expect(result).toEqual([]);
  });

  it("returns untracked non-ignored file", async () => {
    initGitRepo(tmpDir);
    await writeFile(join(tmpDir, "untracked.ts"), "export const y = 2;");

    const result = await getUntrackedNonIgnoredFiles(tmpDir);
    expect(result).toContain("untracked.ts");
  });

  it("does NOT return gitignored files", async () => {
    initGitRepo(tmpDir);
    // .gitignore already contains .ai/ from initGitRepo; add secret.ts
    writeFileSync(join(tmpDir, ".gitignore"), ".ai/\nsecret.ts\n");
    await writeFile(join(tmpDir, "secret.ts"), "const secret = 42;");

    const result = await getUntrackedNonIgnoredFiles(tmpDir);
    expect(result).not.toContain("secret.ts");
  });

  it("does NOT return committed (tracked) files", async () => {
    initGitRepo(tmpDir);
    await writeFile(join(tmpDir, "tracked.ts"), "export const x = 1;");
    execFileSync("git", ["add", "."], { cwd: tmpDir });
    execFileSync("git", ["commit", "-m", "init"], { cwd: tmpDir });

    const result = await getUntrackedNonIgnoredFiles(tmpDir);
    expect(result).not.toContain("tracked.ts");
  });

  it("does NOT return directory entries with trailing slash — only files", async () => {
    initGitRepo(tmpDir);
    const subDir = join(tmpDir, "mydir");
    await mkdir(subDir, { recursive: true });
    await writeFile(join(subDir, "file.ts"), "export const z = 3;");

    const result = await getUntrackedNonIgnoredFiles(tmpDir);
    // The directory itself must not appear with a trailing slash
    expect(result).not.toContain("mydir/");
    // The file inside may appear as mydir/file.ts
    expect(result).toContain("mydir/file.ts");
  });
});

describe("git command execution failures", () => {
  it("throws when git ls-files execution fails unexpectedly", async () => {
    const mockExecFile = vi.fn(
      (_file: string, _args: readonly string[], _options: { cwd: string; maxBuffer: number }, callback: ExecCallback) => {
      callback(new Error("spawn EACCES"));
      },
    );

    const { getGitTrackedFiles: getGitTrackedFilesWithFailure } = await importGitFilesWithMockedExecFile(mockExecFile);

    await expect(getGitTrackedFilesWithFailure(tmpDir)).rejects.toThrow(
      "Failed to execute git ls-files: spawn EACCES",
    );
  });

  it("throws when git deleted-files query fails unexpectedly", async () => {
    const mockExecFile = vi.fn(
      (_file: string, _args: readonly string[], _options: { cwd: string; maxBuffer: number }, callback: ExecCallback) => {
      callback(new Error("spawn ENOENT"));
      },
    );

    const { getGitDeletedFiles: getGitDeletedFilesWithFailure } = await importGitFilesWithMockedExecFile(mockExecFile);

    await expect(getGitDeletedFilesWithFailure(tmpDir)).rejects.toThrow(
      "Failed to execute git ls-files --deleted: spawn ENOENT",
    );
  });

  it("throws when untracked-files query fails unexpectedly", async () => {
    const mockExecFile = vi.fn(
      (_file: string, _args: readonly string[], _options: { cwd: string; maxBuffer: number }, callback: ExecCallback) => {
      callback(new Error("spawn ETIMEDOUT"));
      },
    );

    const { getUntrackedNonIgnoredFiles: getUntrackedNonIgnoredFilesWithFailure } =
      await importGitFilesWithMockedExecFile(mockExecFile);

    await expect(getUntrackedNonIgnoredFilesWithFailure(tmpDir)).rejects.toThrow(
      "Failed to execute git ls-files --others --exclude-standard: spawn ETIMEDOUT",
    );
  });
});
