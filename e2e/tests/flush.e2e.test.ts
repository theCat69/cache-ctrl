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

describe("flush", () => {
  it("flushes all external entries with --confirm", async () => {
    const flushResult = await runCli(["flush", "external", "--confirm"], { cwd: repo.dir });
    expect(flushResult.exitCode).toBe(0);

    const flushOutput = parseJsonOutput<{
      ok: boolean;
      value: { count: number; deleted: string[] };
    }>(flushResult.stdout);
    expect(flushOutput.ok).toBe(true);
    expect(flushOutput.value.count).toBeGreaterThanOrEqual(1);
    expect(flushOutput.value.deleted.some((p) => p.endsWith(".json"))).toBe(true);

    // Verify external cache is now empty
    const listResult = await runCli(["list", "--agent", "external"], { cwd: repo.dir });
    expect(listResult.exitCode).toBe(0);
    const listOutput = parseJsonOutput<{ ok: boolean; value: unknown[] }>(listResult.stdout);
    expect(listOutput.ok).toBe(true);
    expect(listOutput.value).toHaveLength(0);
  });

  it("without --confirm, flush returns error with code CONFIRMATION_REQUIRED", async () => {
    const result = await runCli(["flush", "external"], { cwd: repo.dir });
    expect(result.exitCode).toBe(1);

    const errorOutput = parseJsonOutput<{ ok: boolean; code: string }>(result.stderr);
    expect(errorOutput.ok).toBe(false);
    expect(errorOutput.code).toBe("CONFIRMATION_REQUIRED");
  });

  it("flush all --confirm removes both agents", async () => {
    const flushResult = await runCli(["flush", "all", "--confirm"], { cwd: repo.dir });
    expect(flushResult.exitCode).toBe(0);

    const flushOutput = parseJsonOutput<{
      ok: boolean;
      value: { count: number; deleted: string[] };
    }>(flushResult.stdout);
    expect(flushOutput.ok).toBe(true);
    expect(flushOutput.value.count).toBe(2);

    // Verify all entries are gone
    const listResult = await runCli(["list"], { cwd: repo.dir });
    expect(listResult.exitCode).toBe(0);
    const listOutput = parseJsonOutput<{ ok: boolean; value: unknown[] }>(listResult.stdout);
    expect(listOutput.ok).toBe(true);
    expect(listOutput.value).toHaveLength(0);
  });

  it("missing agent arg exits with code 2", async () => {
    const result = await runCli(["flush", "--confirm"], { cwd: repo.dir });
    expect(result.exitCode).toBe(2);

    const errorOutput = parseJsonOutput<{ ok: boolean; code: string }>(result.stderr);
    expect(errorOutput.ok).toBe(false);
    expect(errorOutput.code).toBe("INVALID_ARGS");
  });

  it("invalid agent exits with code 2", async () => {
    const result = await runCli(["flush", "badagent", "--confirm"], { cwd: repo.dir });
    expect(result.exitCode).toBe(2);

    const errorOutput = parseJsonOutput<{ ok: boolean; code: string }>(result.stderr);
    expect(errorOutput.ok).toBe(false);
    expect(errorOutput.code).toBe("INVALID_ARGS");
  });
});
