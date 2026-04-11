import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function parseGitOutput(stdout: string): string[] {
  return stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/**
 * Returns git-tracked file paths for a repository.
 *
 * Falls back to `[]` when git is unavailable, command execution fails, or directory is not a git repo.
 */
export async function getGitTrackedFiles(repoRoot: string): Promise<string[]> {
  try {
    const result = await execFileAsync("git", ["ls-files"], { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 });
    return parseGitOutput(result.stdout);
  } catch {
    return [];
  }
}

/**
 * Returns git-tracked files deleted from the working tree.
 *
 * Falls back to `[]` when git is unavailable, command execution fails, or directory is not a git repo.
 */
export async function getGitDeletedFiles(repoRoot: string): Promise<string[]> {
  try {
    const result = await execFileAsync("git", ["ls-files", "--deleted"], { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 });
    return parseGitOutput(result.stdout);
  } catch {
    return [];
  }
}

/**
 * Returns untracked files that are not ignored by git.
 *
 * Falls back to `[]` when git is unavailable, command execution fails, or directory is not a git repo.
 */
export async function getUntrackedNonIgnoredFiles(repoRoot: string): Promise<string[]> {
  try {
    const result = await execFileAsync("git", ["ls-files", "--others", "--exclude-standard"], {
      cwd: repoRoot,
      maxBuffer: 10 * 1024 * 1024,
    });
    return parseGitOutput(result.stdout).filter((p) => !p.endsWith("/"));
  } catch {
    return [];
  }
}
