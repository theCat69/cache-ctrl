import { mkdtemp, cp, rm } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * Absolute path to the baked fixture repo template inside the Docker container.
 * This directory is copied for each test to ensure full isolation.
 */
export const FIXTURE_TEMPLATE = "/fixtures/repo-template";

/**
 * A live test repo — a temp copy of the fixture template.
 */
export interface TestRepo {
  /** Absolute path to the isolated temp directory for this test. Pass as `cwd` to runCli(). */
  dir: string;
  /** Removes the temp directory. Call in afterEach(). */
  cleanup: () => Promise<void>;
}

/**
 * Creates an isolated copy of the fixture repo template.
 *
 * Each call produces a distinct temp directory under the OS temp dir.
 * The copied directory contains:
 *   - src/file-a.ts and src/file-b.ts (git-tracked source files)
 *   - .ai/external-context-gatherer_cache/sample-external.json (stale external entry)
 *   - .ai/local-context-gatherer_cache/context.json (stale local entry)
 *   - .git/ (a real git repo with one commit tracking src/ files)
 *
 * IMPORTANT: The fixture template's .gitignore excludes .ai/, so git does
 * not track the cache files — but they ARE present on disk.
 *
 * Usage:
 *   let repo: TestRepo;
 *   beforeEach(async () => { repo = await createTestRepo(); });
 *   afterEach(async () => { await repo.cleanup(); });
 *   // in test:
 *   const result = await runCli(["list"], { cwd: repo.dir });
 */
export async function createTestRepo(): Promise<TestRepo> {
  const dir = await mkdtemp(join(tmpdir(), "cache-ctrl-e2e-"));
  await cp(FIXTURE_TEMPLATE, dir, { recursive: true });
  return {
    dir,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

/**
 * Initializes a git repository with identity and a committed `.gitignore`.
 *
 * This helper is shared by unit tests that need deterministic git state.
 */
export function initGitRepo(dir: string): void {
  execFileSync("git", ["init"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  writeFileSync(join(dir, ".gitignore"), ".ai/\n");
  execFileSync("git", ["add", ".gitignore"], { cwd: dir });
  execFileSync("git", ["commit", "-m", "chore: init gitignore"], { cwd: dir });
}
