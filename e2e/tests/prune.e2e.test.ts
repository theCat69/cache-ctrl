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

describe("prune", () => {
  it("dry-run lists stale entries without deleting them", async () => {
    // Both fixture entries have old timestamps — they are stale
    const pruneResult = await runCli(["prune"], { cwd: repo.dir });
    expect(pruneResult.exitCode).toBe(0);

    const output = parseJsonOutput<{
      ok: boolean;
      value: { matched: unknown[]; action: string };
    }>(pruneResult.stdout);
    expect(output.ok).toBe(true);
    expect(output.value.matched.length).toBeGreaterThanOrEqual(1);
    // Dry-run (no --delete) invalidates timestamps but does NOT delete files
    expect(output.value.action).toBe("invalidated");

    // Verify files are still present
    const listResult = await runCli(["list"], { cwd: repo.dir });
    expect(listResult.exitCode).toBe(0);
    const listOutput = parseJsonOutput<{ ok: boolean; value: unknown[] }>(listResult.stdout);
    expect(listOutput.ok).toBe(true);
    expect(listOutput.value.length).toBeGreaterThanOrEqual(2);
  });

  it("--delete removes stale entries", async () => {
    const pruneResult = await runCli(["prune", "--delete"], { cwd: repo.dir });
    expect(pruneResult.exitCode).toBe(0);

    const output = parseJsonOutput<{
      ok: boolean;
      value: { matched: unknown[]; action: string };
    }>(pruneResult.stdout);
    expect(output.ok).toBe(true);
    expect(output.value.matched.length).toBeGreaterThanOrEqual(1);
    expect(output.value.action).toBe("deleted");

    // Verify list returns fewer entries than before
    const listResult = await runCli(["list"], { cwd: repo.dir });
    expect(listResult.exitCode).toBe(0);
    const listOutput = parseJsonOutput<{ ok: boolean; value: unknown[] }>(listResult.stdout);
    expect(listOutput.ok).toBe(true);
    expect(listOutput.value.length).toBeLessThan(2);
  });

  it("--max-age filters: entries newer than threshold are not pruned", async () => {
    // Touch the external sample entry to make it fresh
    const touchResult = await runCli(["touch", "external", "sample"], { cwd: repo.dir });
    expect(touchResult.exitCode).toBe(0);

    // Prune with 1h max-age — the freshly-touched entry is within threshold
    const pruneResult = await runCli(["prune", "--max-age", "1h"], { cwd: repo.dir });
    expect(pruneResult.exitCode).toBe(0);

    const output = parseJsonOutput<{
      ok: boolean;
      value: { matched: Array<{ subject: string }> };
    }>(pruneResult.stdout);
    expect(output.ok).toBe(true);
    // The freshly-touched external entry should NOT be in matched
    expect(output.value.matched.every((e) => e.subject !== "sample")).toBe(true);
  });

  it("--agent filters to specific agent", async () => {
    const result = await runCli(["prune", "--agent", "external"], { cwd: repo.dir });
    expect(result.exitCode).toBe(0);

    const output = parseJsonOutput<{
      ok: boolean;
      value: { matched: Array<{ agent: string }> };
    }>(result.stdout);
    expect(output.ok).toBe(true);
    expect(output.value.matched.every((e) => e.agent === "external")).toBe(true);
  });

  it("invalid --agent exits with code 2", async () => {
    const result = await runCli(["prune", "--agent", "badvalue"], { cwd: repo.dir });
    expect(result.exitCode).toBe(2);

    const errorOutput = parseJsonOutput<{ ok: boolean; code: string }>(result.stderr);
    expect(errorOutput.ok).toBe(false);
    expect(errorOutput.code).toBe("INVALID_ARGS");
  });
});
