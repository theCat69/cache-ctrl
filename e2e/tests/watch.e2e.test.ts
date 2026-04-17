import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";

import { runCli, runCliWithTimeout } from "../helpers/cli.ts";
import { createTestRepo, type TestRepo } from "../helpers/repo.ts";

let repo: TestRepo;

beforeEach(async () => {
  repo = await createTestRepo();
});

afterEach(async () => {
  await repo.cleanup();
});

describe("watch", () => {
  function assertWatchStarted(result: { exitCode: number; stdout: string; stderr: string }): void {
    expect(result.exitCode).toBe(-1);
    expect(result.stdout).toContain("[watch] Initial graph computed");
    expect(result.stderr).not.toContain("Bun.watch is not available in this runtime");
  }

  it("builds the initial graph and writes graph.json", async () => {
    const result = await runCliWithTimeout(["watch", "--verbose"], 10_000, { cwd: repo.dir });

    assertWatchStarted(result);

    const graphPath = join(repo.dir, ".ai", "local-context-gatherer_cache", "graph.json");
    expect(existsSync(graphPath)).toBe(true);
  });

  it("handles an empty repository with no source files", async () => {
    await rm(join(repo.dir, "src"), { recursive: true, force: true });

    const result = await runCliWithTimeout(["watch", "--verbose"], 10_000, { cwd: repo.dir });

    assertWatchStarted(result);

    const graphPath = join(repo.dir, ".ai", "local-context-gatherer_cache", "graph.json");
    expect(existsSync(graphPath)).toBe(true);
  });

  it("watch --unknown-flag exits with an argument error", async () => {
    const result = await runCli(["watch", "--unknown-flag"], { cwd: repo.dir });

    expect(result.exitCode).toBe(2);
    expect(result.stderr.length > 0 || result.stdout.length > 0).toBe(true);
  });
});
