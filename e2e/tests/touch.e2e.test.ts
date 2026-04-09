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

describe("touch", () => {
  it("refreshes fetched_at timestamp of a matched external entry", async () => {
    const before = Date.now();
    const result = await runCli(["touch", "external", "sample"], { cwd: repo.dir });
    const after = Date.now();

    expect(result.exitCode).toBe(0);

    const output = parseJsonOutput<{
      ok: boolean;
      value: { touched: string[]; new_timestamp: string };
    }>(result.stdout);
    expect(output.ok).toBe(true);
    expect(output.value.touched.some((p) => p.endsWith("sample.json"))).toBe(true);

    const newTs = new Date(output.value.new_timestamp).getTime();
    expect(newTs).toBeGreaterThanOrEqual(before - 500);
    expect(newTs).toBeLessThanOrEqual(after + 500);

    // After touch the entry should no longer be stale
    const listResult = await runCli(["list", "--agent", "external"], { cwd: repo.dir });
    expect(listResult.exitCode).toBe(0);
    const listOutput = parseJsonOutput<{
      ok: boolean;
      value: Array<{ subject: string; is_stale: boolean }>;
    }>(listResult.stdout);
    expect(listOutput.ok).toBe(true);
    const sampleEntry = listOutput.value.find((e) => e.subject === "sample");
    expect(sampleEntry).toBeDefined();
    expect(sampleEntry?.is_stale).toBe(false);
  });

  it("touches local entry (timestamp updated to now)", async () => {
    // Use fixture as-is — .ai/ is pre-populated with the local context entry.
    // Do NOT rm .ai/ before this test.
    const before = Date.now();
    const result = await runCli(["touch", "local"], { cwd: repo.dir });
    const after = Date.now();

    expect(result.exitCode).toBe(0);

    const output = parseJsonOutput<{
      ok: boolean;
      value: { touched: string[]; new_timestamp: string };
    }>(result.stdout);
    expect(output.ok).toBe(true);
    expect(output.value.touched.length).toBeGreaterThanOrEqual(1);

    const newTs = new Date(output.value.new_timestamp).getTime();
    expect(newTs).toBeGreaterThanOrEqual(before - 500);
    expect(newTs).toBeLessThanOrEqual(after + 500);
  });

  it("missing agent arg exits with code 2", async () => {
    const result = await runCli(["touch"], { cwd: repo.dir });
    expect(result.exitCode).toBe(2);

    const errorOutput = parseJsonOutput<{ ok: boolean; code: string }>(result.stderr);
    expect(errorOutput.ok).toBe(false);
    expect(errorOutput.code).toBe("INVALID_ARGS");
  });

  it("invalid agent exits with code 2", async () => {
    const result = await runCli(["touch", "badagent"], { cwd: repo.dir });
    expect(result.exitCode).toBe(2);

    const errorOutput = parseJsonOutput<{ ok: boolean; code: string }>(result.stderr);
    expect(errorOutput.ok).toBe(false);
    expect(errorOutput.code).toBe("INVALID_ARGS");
  });
});
