import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function parseGitOutput(stdout: string): string[] {
  return stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

async function runGitCommand(args: string[], repoRoot: string): Promise<string[]> {
  try {
    const result = await execFileAsync("git", args, { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 });
    return parseGitOutput(result.stdout);
  } catch {
    return [];
  }
}

/**
 * Returns git-tracked file paths for a repository.
 *
 * Falls back to `[]` when git is unavailable, command execution fails, or directory is not a git repo.
 */
export async function getGitTrackedFiles(repoRoot: string): Promise<string[]> {
  return runGitCommand(["ls-files"], repoRoot);
}

/**
 * Returns git-tracked files deleted from the working tree.
 *
 * Falls back to `[]` when git is unavailable, command execution fails, or directory is not a git repo.
 */
export async function getGitDeletedFiles(repoRoot: string): Promise<string[]> {
  return runGitCommand(["ls-files", "--deleted"], repoRoot);
}

/**
 * Returns untracked files that are not ignored by git.
 *
 * Falls back to `[]` when git is unavailable, command execution fails, or directory is not a git repo.
 */
export async function getUntrackedNonIgnoredFiles(repoRoot: string): Promise<string[]> {
  const files = await runGitCommand(["ls-files", "--others", "--exclude-standard"], repoRoot);
  return files.filter((p) => !p.endsWith("/"));
}
