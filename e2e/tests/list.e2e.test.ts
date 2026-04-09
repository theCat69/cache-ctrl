import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { runCli, parseJsonOutput } from "../helpers/cli.ts";
import { createTestRepo, type TestRepo } from "../helpers/repo.ts";

let repo: TestRepo;

beforeEach(async () => {
  repo = await createTestRepo();
});

afterEach(async () => {
  await repo.cleanup();
});

describe("list", () => {
  it("exits 0 and returns ok:true with empty results when no .ai dir exists", async () => {
    await rm(join(repo.dir, ".ai"), { recursive: true, force: true });

    const result = await runCli(["list"], { cwd: repo.dir });
    expect(result.exitCode).toBe(0);

    const output = parseJsonOutput<{ ok: boolean; value: unknown[] }>(result.stdout);
    expect(output.ok).toBe(true);
    expect(output.value).toHaveLength(0);
  });

  it("lists all entries when --agent all (or no --agent flag)", async () => {
    const result = await runCli(["list", "--agent", "all"], { cwd: repo.dir });
    expect(result.exitCode).toBe(0);

    const output = parseJsonOutput<{
      ok: boolean;
      value: Array<{ agent: string; subject: string }>;
    }>(result.stdout);
    expect(output.ok).toBe(true);
    expect(output.value).toHaveLength(2);
    expect(output.value.some((e) => e.agent === "external")).toBe(true);
    expect(output.value.some((e) => e.agent === "local")).toBe(true);
  });

  it("filters to external only with --agent external", async () => {
    const result = await runCli(["list", "--agent", "external"], { cwd: repo.dir });
    expect(result.exitCode).toBe(0);

    const output = parseJsonOutput<{
      ok: boolean;
      value: Array<{ agent: string }>;
    }>(result.stdout);
    expect(output.ok).toBe(true);
    expect(output.value.every((e) => e.agent === "external")).toBe(true);
  });

  it("filters to local only with --agent local", async () => {
    const result = await runCli(["list", "--agent", "local"], { cwd: repo.dir });
    expect(result.exitCode).toBe(0);

    const output = parseJsonOutput<{
      ok: boolean;
      value: Array<{ agent: string }>;
    }>(result.stdout);
    expect(output.ok).toBe(true);
    expect(output.value.every((e) => e.agent === "local")).toBe(true);
  });

  it("invalid --agent value exits with code 2", async () => {
    const result = await runCli(["list", "--agent", "invalid"], { cwd: repo.dir });
    expect(result.exitCode).toBe(2);

    const errorOutput = parseJsonOutput<{ ok: boolean; code: string }>(result.stderr);
    expect(errorOutput.ok).toBe(false);
    expect(errorOutput.code).toBe("INVALID_ARGS");
  });
});
