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

describe("invalidate", () => {
  it("invalidates specific external entry by subject keyword", async () => {
    const result = await runCli(["invalidate", "external", "sample"], { cwd: repo.dir });
    expect(result.exitCode).toBe(0);

    const output = parseJsonOutput<{
      ok: boolean;
      value: { invalidated: unknown[] };
    }>(result.stdout);
    expect(output.ok).toBe(true);
    expect(output.value.invalidated).toHaveLength(1);
  });

  it("after invalidate, list shows entry as stale", async () => {
    const invalidateResult = await runCli(["invalidate", "external", "sample"], {
      cwd: repo.dir,
    });
    expect(invalidateResult.exitCode).toBe(0);

    const listResult = await runCli(["list", "--agent", "external"], { cwd: repo.dir });
    expect(listResult.exitCode).toBe(0);

    const listOutput = parseJsonOutput<{
      ok: boolean;
      value: Array<{ subject: string; is_stale: boolean }>;
    }>(listResult.stdout);
    expect(listOutput.ok).toBe(true);
    const sampleEntry = listOutput.value.find((e) => e.subject === "sample");
    expect(sampleEntry).toBeDefined();
    expect(sampleEntry?.is_stale).toBe(true);
  });

  it("invalidates all local entries (no subject arg)", async () => {
    const result = await runCli(["invalidate", "local"], { cwd: repo.dir });
    expect(result.exitCode).toBe(0);

    const output = parseJsonOutput<{
      ok: boolean;
      value: { invalidated: unknown[] };
    }>(result.stdout);
    expect(output.ok).toBe(true);
    expect(output.value.invalidated.length).toBeGreaterThanOrEqual(1);
  });

  it("missing agent arg exits with code 2", async () => {
    const result = await runCli(["invalidate"], { cwd: repo.dir });
    expect(result.exitCode).toBe(2);

    const errorOutput = parseJsonOutput<{ ok: boolean; code: string }>(result.stderr);
    expect(errorOutput.ok).toBe(false);
    expect(errorOutput.code).toBe("INVALID_ARGS");
  });

  it("invalid agent value exits with code 2", async () => {
    const result = await runCli(["invalidate", "notanagent"], { cwd: repo.dir });
    expect(result.exitCode).toBe(2);

    const errorOutput = parseJsonOutput<{ ok: boolean; code: string }>(result.stderr);
    expect(errorOutput.ok).toBe(false);
    expect(errorOutput.code).toBe("INVALID_ARGS");
  });
});
