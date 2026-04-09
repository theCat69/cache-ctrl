import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runCli, parseJsonOutput } from "../helpers/cli.ts";
import { createTestRepo, type TestRepo } from "../helpers/repo.ts";

let repo: TestRepo;

beforeEach(async () => {
  repo = await createTestRepo();
});

afterEach(async () => {
  await repo.cleanup();
});

describe("check-files", () => {
  it("returns FILE_NOT_FOUND when no local cache exists", async () => {
    await rm(join(repo.dir, ".ai"), { recursive: true, force: true });

    const result = await runCli(["check-files"], { cwd: repo.dir });
    expect(result.exitCode).toBe(1);

    const errorOutput = parseJsonOutput<{ ok: boolean; code: string }>(result.stderr);
    expect(errorOutput.ok).toBe(false);
    expect(errorOutput.code).toBe("FILE_NOT_FOUND");
  });

  it("returns status:changed when fixture cache has stale mtime for tracked files", async () => {
    // Fixture context.json has mtime 1735689600000 — copied files have current mtime
    const result = await runCli(["check-files"], { cwd: repo.dir });
    expect(result.exitCode).toBe(0);

    const output = parseJsonOutput<{
      ok: boolean;
      value: {
        status: string;
        changed_files: Array<{ path: string }>;
      };
    }>(result.stdout);
    expect(output.ok).toBe(true);
    expect(output.value.status).toBe("changed");
    const changedPaths = output.value.changed_files.map((f) => f.path);
    expect(
      changedPaths.includes("src/file-a.ts") || changedPaths.includes("src/file-b.ts"),
    ).toBe(true);
  });

  it("returns status:unchanged after writing cache with correct mtime values", async () => {
    await rm(join(repo.dir, ".ai"), { recursive: true, force: true });

    // Write local cache with empty tracked_files — no files to compare
    const writeData = { topic: "t", description: "d", tracked_files: [] };
    const writeResult = await runCli(
      ["write", "local", "--data", JSON.stringify(writeData)],
      { cwd: repo.dir },
    );
    expect(writeResult.exitCode).toBe(0);

    const checkResult = await runCli(["check-files"], { cwd: repo.dir });
    expect(checkResult.exitCode).toBe(0);

    const output = parseJsonOutput<{
      ok: boolean;
      value: { status: string; changed_files: unknown[] };
    }>(checkResult.stdout);
    expect(output.ok).toBe(true);
    expect(output.value.status).toBe("unchanged");
    expect(output.value.changed_files).toHaveLength(0);
  });

  it("returns new_files when an untracked-non-ignored file exists not in cache", async () => {
    await rm(join(repo.dir, ".ai"), { recursive: true, force: true });

    // Write local cache with empty tracked_files
    const writeData = { topic: "t", description: "d", tracked_files: [] };
    const writeResult = await runCli(
      ["write", "local", "--data", JSON.stringify(writeData)],
      { cwd: repo.dir },
    );
    expect(writeResult.exitCode).toBe(0);

    // Create a new untracked non-ignored file
    await writeFile(
      join(repo.dir, "src", "new-file.ts"),
      "export const newFile = 1;\n",
      "utf-8",
    );

    const checkResult = await runCli(["check-files"], { cwd: repo.dir });
    expect(checkResult.exitCode).toBe(0);

    const output = parseJsonOutput<{
      ok: boolean;
      value: { status: string; new_files: string[] };
    }>(checkResult.stdout);
    expect(output.ok).toBe(true);
    expect(output.value.status).toBe("changed");
    expect(output.value.new_files).toContain("src/new-file.ts");
  });

  it("returns deleted_git_files when a git-tracked file is removed from working tree", async () => {
    await rm(join(repo.dir, ".ai"), { recursive: true, force: true });

    // Write local cache tracking src/file-a.ts specifically
    const writeData = {
      topic: "t",
      description: "d",
      tracked_files: [{ path: "src/file-a.ts" }],
    };
    const writeResult = await runCli(
      ["write", "local", "--data", JSON.stringify(writeData)],
      { cwd: repo.dir },
    );
    expect(writeResult.exitCode).toBe(0);

    // Delete src/file-a.ts from disk
    await unlink(join(repo.dir, "src", "file-a.ts"));

    const checkResult = await runCli(["check-files"], { cwd: repo.dir });
    expect(checkResult.exitCode).toBe(0);

    const output = parseJsonOutput<{
      ok: boolean;
      value: {
        status: string;
        deleted_git_files: string[];
        missing_files: string[];
      };
    }>(checkResult.stdout);
    expect(output.ok).toBe(true);
    expect(output.value.status).toBe("changed");
    expect(output.value.deleted_git_files).toContain("src/file-a.ts");
    expect(output.value.missing_files).toContain("src/file-a.ts");
  });
});
