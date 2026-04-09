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

describe("smoke: external cache pipeline", () => {
  it("write external → list → inspect → search → invalidate → list again", async () => {
    await rm(join(repo.dir, ".ai"), { recursive: true, force: true });

    // Step 1: write external entry
    const writeData = {
      subject: "mysmoke",
      description: "smoke test external entry",
      fetched_at: "2026-04-01T00:00:00Z",
      sources: [],
      header_metadata: {},
    };
    const writeResult = await runCli(
      ["write", "external", "mysmoke", "--data", JSON.stringify(writeData)],
      { cwd: repo.dir },
    );
    expect(writeResult.exitCode).toBe(0);
    const writeOutput = parseJsonOutput<{ ok: boolean }>(writeResult.stdout);
    expect(writeOutput.ok).toBe(true);

    // Step 2: list
    const listResult = await runCli(["list", "--agent", "external"], { cwd: repo.dir });
    expect(listResult.exitCode).toBe(0);
    const listOutput = parseJsonOutput<{
      ok: boolean;
      value: Array<{ subject: string; agent: string }>;
    }>(listResult.stdout);
    expect(listOutput.ok).toBe(true);
    expect(listOutput.value.length).toBeGreaterThanOrEqual(1);
    expect(listOutput.value.some((e) => e.subject === "mysmoke")).toBe(true);

    // Step 3: inspect
    const inspectResult = await runCli(["inspect", "external", "mysmoke"], { cwd: repo.dir });
    expect(inspectResult.exitCode).toBe(0);
    const inspectOutput = parseJsonOutput<{
      ok: boolean;
      value: { subject: string; description: string };
    }>(inspectResult.stdout);
    expect(inspectOutput.ok).toBe(true);
    expect(inspectOutput.value.subject).toBe("mysmoke");
    expect(inspectOutput.value.description).toBeTruthy();

    // Step 4: search
    const searchResult = await runCli(["search", "mysmoke"], { cwd: repo.dir });
    expect(searchResult.exitCode).toBe(0);
    const searchOutput = parseJsonOutput<{
      ok: boolean;
      value: Array<{ subject: string }>;
    }>(searchResult.stdout);
    expect(searchOutput.ok).toBe(true);
    expect(searchOutput.value.some((e) => e.subject === "mysmoke")).toBe(true);

    // Step 5: invalidate
    const invalidateResult = await runCli(["invalidate", "external", "mysmoke"], {
      cwd: repo.dir,
    });
    expect(invalidateResult.exitCode).toBe(0);
    const invalidateOutput = parseJsonOutput<{
      ok: boolean;
      value: { invalidated: unknown[] };
    }>(invalidateResult.stdout);
    expect(invalidateOutput.ok).toBe(true);
    expect(invalidateOutput.value.invalidated.length).toBeGreaterThanOrEqual(1);

    // Step 6: list again — mysmoke should now be stale
    const listAfterResult = await runCli(["list", "--agent", "external"], { cwd: repo.dir });
    expect(listAfterResult.exitCode).toBe(0);
    const listAfterOutput = parseJsonOutput<{
      ok: boolean;
      value: Array<{ subject: string; is_stale: boolean }>;
    }>(listAfterResult.stdout);
    expect(listAfterOutput.ok).toBe(true);
    const smokeEntry = listAfterOutput.value.find((e) => e.subject === "mysmoke");
    expect(smokeEntry).toBeDefined();
    expect(smokeEntry?.is_stale).toBe(true);
  });
});

describe("smoke: local cache pipeline", () => {
  it("write local → check-files → invalidate → list again", async () => {
    await rm(join(repo.dir, ".ai"), { recursive: true, force: true });

    // Step 1: write local with empty tracked_files
    const writeData = { topic: "smoke", description: "smoke test", tracked_files: [] };
    const writeResult = await runCli(
      ["write", "local", "--data", JSON.stringify(writeData)],
      { cwd: repo.dir },
    );
    expect(writeResult.exitCode).toBe(0);
    const writeOutput = parseJsonOutput<{ ok: boolean }>(writeResult.stdout);
    expect(writeOutput.ok).toBe(true);

    // Step 2: check-files — empty tracked_files means nothing to check → unchanged
    const checkResult = await runCli(["check-files"], { cwd: repo.dir });
    expect(checkResult.exitCode).toBe(0);
    const checkOutput = parseJsonOutput<{
      ok: boolean;
      value: { status: string };
    }>(checkResult.stdout);
    expect(checkOutput.ok).toBe(true);
    expect(checkOutput.value.status).toBe("unchanged");

    // Step 3: invalidate local
    const invalidateResult = await runCli(["invalidate", "local"], { cwd: repo.dir });
    expect(invalidateResult.exitCode).toBe(0);
    const invalidateOutput = parseJsonOutput<{
      ok: boolean;
      value: { invalidated: unknown[] };
    }>(invalidateResult.stdout);
    expect(invalidateOutput.ok).toBe(true);
    expect(invalidateOutput.value.invalidated.length).toBeGreaterThanOrEqual(1);

    // Step 4: list local — entry should now be stale
    const listResult = await runCli(["list", "--agent", "local"], { cwd: repo.dir });
    expect(listResult.exitCode).toBe(0);
    const listOutput = parseJsonOutput<{
      ok: boolean;
      value: Array<{ is_stale: boolean }>;
    }>(listResult.stdout);
    expect(listOutput.ok).toBe(true);
    expect(listOutput.value.length).toBeGreaterThanOrEqual(1);
    expect(listOutput.value[0]?.is_stale).toBe(true);
  });
});
