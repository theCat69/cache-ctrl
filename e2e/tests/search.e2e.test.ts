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

describe("search", () => {
  it("finds external entry by subject keyword", async () => {
    const result = await runCli(["search", "sample"], { cwd: repo.dir });
    expect(result.exitCode).toBe(0);

    const output = parseJsonOutput<{
      ok: boolean;
      value: Array<{ subject: string; agent: string; description: string; score: number }>;
    }>(result.stdout);
    expect(output.ok).toBe(true);
    expect(output.value.length).toBeGreaterThanOrEqual(1);
    expect(output.value.some((e) => e.subject.includes("sample"))).toBe(true);

    // Verify descending score order when multiple results
    for (let i = 1; i < output.value.length; i++) {
      expect(output.value[i - 1]!.score).toBeGreaterThanOrEqual(output.value[i]!.score);
    }
  });

  it("finds local entry by description keyword", async () => {
    const result = await runCli(["search", "fixture"], { cwd: repo.dir });
    expect(result.exitCode).toBe(0);

    const output = parseJsonOutput<{
      ok: boolean;
      value: Array<{ agent: string }>;
    }>(result.stdout);
    expect(output.ok).toBe(true);
    expect(output.value.some((e) => e.agent === "local")).toBe(true);
  });

  it("returns empty results array for unknown keyword", async () => {
    const result = await runCli(["search", "xyzzy-nonexistent-keyword-9999"], {
      cwd: repo.dir,
    });
    expect(result.exitCode).toBe(0);

    const output = parseJsonOutput<{ ok: boolean; value: unknown[] }>(result.stdout);
    expect(output.ok).toBe(true);
    expect(output.value).toHaveLength(0);
  });

  it("missing keyword arg exits with code 2", async () => {
    const result = await runCli(["search"], { cwd: repo.dir });
    expect(result.exitCode).toBe(2);

    const errorOutput = parseJsonOutput<{ ok: boolean; code: string }>(result.stderr);
    expect(errorOutput.ok).toBe(false);
    expect(errorOutput.code).toBe("INVALID_ARGS");
  });
});
