import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { runCli, parseJsonOutput } from "../helpers/cli.ts";
import { createTestRepo, type TestRepo } from "../helpers/repo.ts";

let repo: TestRepo;

beforeEach(async () => {
  repo = await createTestRepo();
});

afterEach(async () => {
  await repo.cleanup();
});

const ALL_COMMANDS = [
  "list",
  "inspect",
  "flush",
  "invalidate",
  "touch",
  "prune",
  "check-files",
  "search",
  "write",
] as const;

describe("help", () => {
  it("--help flag exits 0 and stdout contains 'Usage'", async () => {
    const result = await runCli(["--help"], { cwd: repo.dir });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage");
    expect(result.stdout).toContain("cache-ctrl");
  });

  it("--help lists all 10 command names in stdout", async () => {
    const result = await runCli(["--help"], { cwd: repo.dir });
    expect(result.exitCode).toBe(0);

    for (const commandName of ALL_COMMANDS) {
      expect(result.stdout).toContain(commandName);
    }
  });

  it("help <command> shows command-specific usage", async () => {
    const result = await runCli(["help", "list"], { cwd: repo.dir });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("list");
    expect(result.stdout).toContain("--agent");
  });

  it("help unknown-cmd exits 1 with stderr containing 'Unknown command'", async () => {
    const result = await runCli(["help", "unknown-cmd"], { cwd: repo.dir });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown command");
  });

  it("no args exits 2 with INVALID_ARGS", async () => {
    const result = await runCli([], { cwd: repo.dir });
    expect(result.exitCode).toBe(2);

    const errorOutput = parseJsonOutput<{ ok: boolean; code: string }>(result.stderr);
    expect(errorOutput.ok).toBe(false);
    expect(errorOutput.code).toBe("INVALID_ARGS");
  });
});
