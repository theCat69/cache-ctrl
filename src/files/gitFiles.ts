import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

interface GitExecError extends Error {
  code?: number | string;
  stderr?: string;
}

function isGitExecError(value: unknown): value is GitExecError {
  return value instanceof Error;
}

function isNotGitRepositoryError(error: unknown): boolean {
  if (!isGitExecError(error)) {
    return false;
  }

  if (error.code !== 128) {
    return false;
  }

  const stderr = typeof error.stderr === "string" ? error.stderr : "";
  return stderr.includes("not a git repository");
}

function toGitFailureMessage(args: string[], error: unknown): string {
  const gitArgs = args.join(" ");
  if (error instanceof Error) {
    return `Failed to execute git ${gitArgs}: ${error.message}`;
  }

  return `Failed to execute git ${gitArgs}: ${String(error)}`;
}

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
  } catch (error: unknown) {
    if (isNotGitRepositoryError(error)) {
      return [];
    }

    throw new Error(toGitFailureMessage(args, error));
  }
}

/**
 * Returns git-tracked file paths for a repository.
 *
 * Returns `[]` only when `repoRoot` is not a git repository.
 * Throws when git execution fails for any other reason.
 */
export async function getGitTrackedFiles(repoRoot: string): Promise<string[]> {
  return runGitCommand(["ls-files"], repoRoot);
}

/**
 * Returns git-tracked files deleted from the working tree.
 *
 * Returns `[]` only when `repoRoot` is not a git repository.
 * Throws when git execution fails for any other reason.
 */
export async function getGitDeletedFiles(repoRoot: string): Promise<string[]> {
  return runGitCommand(["ls-files", "--deleted"], repoRoot);
}

/**
 * Returns untracked files that are not ignored by git.
 *
 * Returns `[]` only when `repoRoot` is not a git repository.
 * Throws when git execution fails for any other reason.
 */
export async function getUntrackedNonIgnoredFiles(repoRoot: string): Promise<string[]> {
  const files = await runGitCommand(["ls-files", "--others", "--exclude-standard"], repoRoot);
  return files.filter((p) => !p.endsWith("/"));
}
